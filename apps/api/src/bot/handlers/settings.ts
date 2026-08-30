import { Composer } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import {
  BOT_SETTINGS,
  SETTING_GROUPS,
  isSettingKey,
  type SettingGroup,
  type SettingKey,
  type SettingValue,
} from "@community-os/shared/bot-settings";
import { defineAbilityFor } from "@community-os/shared/abilities";
import {
  AI_PROVIDERS,
  type AiProvider,
} from "@community-os/shared/ai-catalog";
import {
  isRole,
  ROLE_HIERARCHY,
  type Role,
} from "@community-os/shared/constants";
import type { BotContext, BotConversation } from "../types";
import { env } from "../../env";
import { resolveUser } from "../lib/auth";
import { probeNow } from "../../services/provider-health.service";
import {
  applyChanges,
  getHistory,
  getSettings,
  resetSetting,
  setSetting,
  undoSetting,
  type Actor,
} from "../../services/bot-settings.service";
import {
  renderApplied,
  renderConfirmation,
  renderDraftCard,
  renderIndexPage,
  renderSettingPage,
  type RenderedPage,
} from "../lib/settings-menu";
import {
  detectDrift,
  dropChange,
  invert,
  isDraftExpired,
} from "../lib/settings-draft";
import { parseEditValue } from "../lib/settings-parse";
import { renderWelcome } from "../lib/welcome-template";
import { escapeHtml } from "../lib/telegram-html";

export const settingsHandler = new Composer<BotContext>();

export const SETTINGS_TEXT_CONVERSATION = "settings-text-edit";

interface AdminActor extends Actor {
  role: Role;
}

/**
 * Resolves the caller and checks they may manage settings at all.
 *
 * Every entry point in this file starts with this call. A callback is just a
 * string any client can send, so authorisation is re-checked on every one
 * rather than trusting that the button came from a menu the bot rendered.
 */
async function requireAdmin(ctx: BotContext): Promise<AdminActor | null> {
  const from = ctx.from;
  if (!from) return null;

  const resolved = await resolveUser(String(from.id));
  if (!resolved) return null;

  // `user.role` is nullable in the schema — an unrecognised or missing value
  // must never fall through as a privilege.
  const rawRole = resolved.user.role;
  if (rawRole == null || !isRole(rawRole)) return null;

  const ability = defineAbilityFor({ id: resolved.user.id, role: rawRole });
  if (!ability.can("update", "Settings")) return null;

  return { userId: resolved.user.id, source: "menu", role: rawRole };
}

/**
 * Enforces a setting's own `minRole`, which sits on top of the CASL check.
 *
 * Today every setting defaults to `admin`, so this never rejects — but it is
 * what makes locking `cost.*` to superadmin later a one-word registry edit
 * rather than a permissions refactor.
 */
function canChangeSetting(key: SettingKey, role: Role): boolean {
  const required = BOT_SETTINGS[key].minRole ?? "admin";
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
}

async function denied(ctx: BotContext): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: "Admins only." });
    return;
  }
  await ctx.reply("That's an admin-only command.");
}

/** Answers the callback and edits the current message into a rendered page. */
async function showPage(
  ctx: BotContext,
  page: RenderedPage,
  toast?: string,
): Promise<void> {
  await ctx.answerCallbackQuery(toast ? { text: toast } : undefined);
  await ctx.editMessageText(page.text, {
    parse_mode: page.parseMode,
    reply_markup: page.keyboard,
  });
}

// ── /settings ───────────────────────────────────────────────

settingsHandler.command("settings", async (ctx) => {
  // DM-only: nobody wants a settings menu paginating in front of the group.
  if (ctx.chat?.type !== "private") {
    await ctx.reply(
      `Settings are managed in a DM: https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=settings`,
    );
    return;
  }

  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const snapshot = await getSettings();
  const page = renderIndexPage("availability", snapshot);
  await ctx.reply(page.text, {
    parse_mode: page.parseMode,
    reply_markup: page.keyboard,
  });
});

// ── Index navigation ────────────────────────────────────────

settingsHandler.callbackQuery(/^set:idx:(\w+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const group = ctx.match![1] as SettingGroup;
  if (!SETTING_GROUPS.includes(group)) {
    await ctx.answerCallbackQuery({ text: "Unknown section." });
    return;
  }

  const snapshot = await getSettings();
  await showPage(ctx, renderIndexPage(group, snapshot));
});

// ── Setting detail ──────────────────────────────────────────

settingsHandler.callbackQuery(/^set:view:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  const [snapshot, history] = await Promise.all([
    getSettings(),
    getHistory(key, 1),
  ]);

  const latest = history[0];
  const page = renderSettingPage(
    key,
    snapshot,
    latest ? { by: latest.performedBy, at: latest.at } : null,
  );

  await showPage(ctx, page);
});

// ── Apply a value ───────────────────────────────────────────

settingsHandler.callbackQuery(/^set:edit:([^:]+):(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  const raw = ctx.match![2]!;

  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  if (!canChangeSetting(key, actor.role)) {
    await ctx.answerCallbackQuery({ text: "That setting needs a higher role." });
    return;
  }

  const parsed = parseEditValue(key, raw);
  if (!parsed.ok) {
    await ctx.answerCallbackQuery({ text: parsed.error });
    return;
  }

  const change = await setSetting(key, parsed.value, actor);
  await showPage(ctx, renderConfirmation(change), "Saved.");
});

// ── Reset and undo ──────────────────────────────────────────

settingsHandler.callbackQuery(/^set:reset:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  if (!canChangeSetting(key, actor.role)) {
    await ctx.answerCallbackQuery({ text: "That setting needs a higher role." });
    return;
  }

  const change = await resetSetting(key, actor);
  await showPage(ctx, renderConfirmation(change), "Reset.");
});

settingsHandler.callbackQuery(/^set:undo:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  if (!canChangeSetting(key, actor.role)) {
    await ctx.answerCallbackQuery({ text: "That setting needs a higher role." });
    return;
  }

  const change = await undoSetting(key, actor);
  if (!change) {
    await ctx.answerCallbackQuery({ text: "Nothing to undo." });
    return;
  }

  await showPage(ctx, renderConfirmation(change), "Reverted.");
});

// ── History ─────────────────────────────────────────────────

settingsHandler.callbackQuery(/^set:hist:([^:]*):(\d+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const rawKey = ctx.match![1]!;
  const key = rawKey && isSettingKey(rawKey) ? rawKey : null;

  const entries = await getHistory(key, 20);

  const body =
    entries.length === 0
      ? "No changes recorded yet."
      : entries
          .map((entry) => {
            const label = isSettingKey(entry.key)
              ? BOT_SETTINGS[entry.key].label
              : entry.key;
            const when = entry.at?.toISOString().slice(0, 10) ?? "?";
            const via = entry.source === "ai_draft" ? " · via AI" : "";
            return `• ${escapeHtml(label)} · <i>${escapeHtml(entry.action)}</i> · ${when}${via}`;
          })
          .join("\n");

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`🕘 <b>Recent changes</b>\n\n${body}`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          key
            ? { text: "‹ Back", callback_data: `set:view:${key}` }
            : { text: "‹ Settings", callback_data: "set:idx:availability" },
        ],
      ],
    },
  });
});

// ── Draft callbacks ─────────────────────────────────────────

settingsHandler.callbackQuery(/^set:draft:drop:(\d+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const draft = ctx.session.settingsDraft;
  if (!draft || isDraftExpired(draft, Date.now())) {
    ctx.session.settingsDraft = undefined;
    await ctx.answerCallbackQuery({ text: "That draft expired." });
    return;
  }

  const updated = dropChange(draft, Number(ctx.match![1]));
  ctx.session.settingsDraft = updated;

  const snapshot = await getSettings();
  const page = renderDraftCard(
    updated,
    detectDrift(updated, snapshot as unknown as Record<string, unknown>),
  );

  await showPage(ctx, page);
});

settingsHandler.callbackQuery("set:draft:cancel", async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  ctx.session.settingsDraft = undefined;
  await ctx.answerCallbackQuery({ text: "Discarded." });
  await ctx.editMessageText("Draft discarded. Nothing was changed.");
});

settingsHandler.callbackQuery("set:draft:confirm", async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return denied(ctx);

  const draft = ctx.session.settingsDraft;
  if (!draft || isDraftExpired(draft, Date.now())) {
    ctx.session.settingsDraft = undefined;
    await ctx.answerCallbackQuery({ text: "That draft expired." });
    return;
  }

  // A draft is all-or-nothing, so one over-privileged change rejects the batch
  // rather than silently applying the rest.
  const blocked = draft.changes.filter(
    (c) => isSettingKey(c.key) && !canChangeSetting(c.key, admin.role),
  );
  if (blocked.length > 0) {
    await ctx.answerCallbackQuery({ text: "Some of these need a higher role." });
    return;
  }

  const snapshot = await getSettings();
  const drifted = detectDrift(
    draft,
    snapshot as unknown as Record<string, unknown>,
  );

  // Someone changed one of these between propose and confirm. Re-render rather
  // than applying stale intent over a deliberate newer change.
  if (drifted.length > 0) {
    await showPage(
      ctx,
      renderDraftCard(draft, drifted),
      "Something changed — check again.",
    );
    return;
  }

  const actor: Actor = {
    userId: admin.userId,
    source: "ai_draft",
    rationale: draft.rationale,
  };

  const applied = await applyChanges(
    draft.changes
      .filter((c) => isSettingKey(c.key))
      .map((c) => ({ key: c.key as SettingKey, from: c.from, to: c.to })),
    actor,
  );

  ctx.session.lastAppliedDraft = { ...draft, changes: invert(draft.changes) };
  ctx.session.settingsDraft = undefined;

  await showPage(ctx, renderApplied(applied), "Applied.");
});

settingsHandler.callbackQuery("set:draft:undo", async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return denied(ctx);

  const inverse = ctx.session.lastAppliedDraft;
  if (!inverse || inverse.changes.length === 0) {
    await ctx.answerCallbackQuery({ text: "Nothing to undo." });
    return;
  }

  const applied = await applyChanges(
    inverse.changes
      .filter((c) => isSettingKey(c.key))
      .map((c) => ({ key: c.key as SettingKey, from: c.from, to: c.to })),
    { userId: admin.userId, source: "ai_draft", rationale: "undo" },
  );

  ctx.session.lastAppliedDraft = undefined;

  await showPage(ctx, renderApplied(applied), "Reverted.");
});

// ── Text editing ────────────────────────────────────────────

/**
 * Captures the admin's next message as a text setting's new value.
 *
 * For the welcome templates the new text is sent back rendered, exactly as a
 * joiner would see it, BEFORE it is saved. Telegram rejects a message whose
 * HTML doesn't parse, so a broken tag fails here and the old value survives —
 * that failed send is the validation.
 */
async function settingsTextConversation(
  conversation: BotConversation,
  ctx: BotContext,
  key: SettingKey,
): Promise<void> {
  await ctx.reply(
    `Send the new text for <b>${escapeHtml(BOT_SETTINGS[key].label)}</b>, or /cancel.\n\n` +
      `Placeholders: {name}, {first_name}, {username}`,
    { parse_mode: "HTML" },
  );

  const message = await conversation.waitFor("message:text");
  const text = message.message.text.trim();

  if (text === "/cancel") {
    await ctx.reply("Cancelled — nothing changed.");
    return;
  }

  const parsed = BOT_SETTINGS[key].schema.safeParse(text);
  if (!parsed.success) {
    await ctx.reply("That value isn't valid for this setting. Nothing changed.");
    return;
  }

  if (key.startsWith("welcome.")) {
    const from = ctx.from!;
    const preview = renderWelcome(text, {
      telegramId: from.id,
      firstName: from.first_name,
      username: from.username,
    });

    try {
      await ctx.reply(preview, { parse_mode: "HTML" });
    } catch (err) {
      console.error("[settings] welcome preview rejected:", err);
      await ctx.reply(
        "Telegram rejected that formatting, so I haven't saved it. " +
          "Check your HTML tags and try again.",
      );
      return;
    }
  }

  const actor = await conversation.external(() => requireAdmin(ctx));
  if (!actor) {
    await ctx.reply("That's an admin-only setting.");
    return;
  }

  if (!canChangeSetting(key, actor.role)) {
    await ctx.reply("That setting needs a higher role. Nothing changed.");
    return;
  }

  const change = await conversation.external(() =>
    setSetting(key, parsed.data as SettingValue<typeof key>, actor),
  );

  const page = renderConfirmation(change);
  await ctx.reply(page.text, {
    parse_mode: page.parseMode,
    reply_markup: page.keyboard,
  });
}

settingsHandler.use(
  createConversation(
    async (conversation: BotConversation, ctx: BotContext) => {
      const key = ctx.session.pendingTextSetting;
      if (!key || !isSettingKey(key)) {
        await ctx.reply("I've lost track of which setting that was — try again.");
        return;
      }
      await settingsTextConversation(conversation, ctx, key);
    },
    SETTINGS_TEXT_CONVERSATION,
  ),
);

settingsHandler.callbackQuery(/^set:text:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  ctx.session.pendingTextSetting = key;
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter(SETTINGS_TEXT_CONVERSATION);
});

settingsHandler.callbackQuery(/^set:prev:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  const snapshot = await getSettings();
  const value = snapshot[key];
  if (typeof value !== "string") {
    await ctx.answerCallbackQuery({ text: "Nothing to preview." });
    return;
  }

  const from = ctx.from!;
  const preview = renderWelcome(value, {
    telegramId: from.id,
    firstName: from.first_name,
    username: from.username,
  });

  await ctx.answerCallbackQuery();
  try {
    await ctx.reply(preview, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[settings] preview rejected:", err);
    await ctx.reply("Telegram rejected the current text's formatting.");
  }
});

/**
 * "I topped up — retry now": clears the backoff so the next AI call probes the
 * provider immediately instead of waiting out a window that can reach 24 hours.
 */
settingsHandler.callbackQuery(/^prov:probe:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const provider = ctx.match![1]!;
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
    await ctx.answerCallbackQuery({ text: "Unknown provider." });
    return;
  }

  await probeNow(provider as AiProvider);
  await ctx.answerCallbackQuery({ text: "Will retry on the next call." });
});
