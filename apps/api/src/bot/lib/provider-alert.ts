import { and, eq, inArray } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import {
  AI_CATALOG,
  DEFAULT_TIER_MODELS,
  isConfigurableTier,
  type AiModelKey,
  type AiProvider,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import { bot } from "../bot";
import { db } from "../../db";
import { account, user } from "../../db/schema";
import { getSettings } from "../../services/bot-settings.service";
import { tiersSelecting } from "../../services/model-resolution";
import { createAuditEntry } from "../../middleware/audit";

/**
 * Tells admins a provider has run out of credit, and that a provider is back.
 *
 * Lives in bot/ rather than services/ because it sends Telegram messages;
 * ai.service reaches it through a dynamic import so the service layer keeps no
 * static dependency on the bot. Separate from spend-alert.ts because that file
 * answers to the spend threshold — one trigger per file.
 *
 * Exactly two messages per outage, however long it lasts: one on the
 * transition into the outage, one on recovery. Failed probes in between are
 * silent, because a retry that fails at 03:00 is not news.
 */

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

async function adminChatIds(): Promise<string[]> {
  const admins = await db
    .select({ telegramId: account.accountId })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(
      and(
        // Same filter resolveUser uses — a member with a non-Telegram account
        // row would otherwise yield an account ID that isn't a chat ID.
        eq(account.providerId, "telegram"),
        inArray(user.role, ["admin", "superadmin"]),
      ),
    );

  return admins
    .map((a) => a.telegramId)
    .filter((id): id is string => id !== null);
}

async function dmAdmins(
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  for (const chatId of await adminChatIds()) {
    await bot.api
      .sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch((err) => {
        console.error(`[provider-alert] DM to ${chatId} failed:`, err);
      });
  }
}

/**
 * What each tier currently selects, settings and pinned tiers alike.
 *
 * Returned as a lookup so the pure `tiersSelecting` can be reused here without
 * this module's database dependency leaking into it.
 */
async function currentSelection(): Promise<(tier: AiTier) => AiModelKey> {
  const settings = await getSettings();
  return (tier) =>
    isConfigurableTier(tier)
      ? settings[`ai.model.${tier}`]
      : DEFAULT_TIER_MODELS[tier];
}

/**
 * The outage DM.
 *
 * `triggeringTier` is the tier whose call hit the error; the message covers
 * every affected tier, since one provider usually serves several.
 *
 * The buttons reuse the settings menu's own `set:view:` callback, which opens
 * the real model page for that tier — complete with its chooser, its role
 * check and its audit trail. Building a second picker here would be a second
 * thing to keep in sync with the catalog.
 */
export async function notifyAdminsOfProviderOutage(
  provider: AiProvider,
  triggeringTier: AiTier,
): Promise<void> {
  const label = PROVIDER_LABELS[provider];
  const selectedFor = await currentSelection();
  const affected = tiersSelecting(provider, selectedFor);
  const tiers = affected.length > 0 ? affected : [triggeringTier];

  const lines = tiers.map(
    (tier) => `• <b>${tier}</b> — was ${AI_CATALOG[selectedFor(tier)].label}`,
  );

  const keyboard = new InlineKeyboard();
  for (const tier of tiers) {
    if (!isConfigurableTier(tier)) continue;
    keyboard
      .text(`Choose model for ${tier}`, `set:view:ai.model.${tier}`)
      .row();
  }
  keyboard.text("I topped up — retry now", `prov:probe:${provider}`);

  await dmAdmins(
    `⚠️ <b>${label} has run out of credits.</b>\n\n` +
      `${lines.join("\n")}\n\n` +
      `Those tiers are running on a fallback model for now. ` +
      `Pick a deliberate replacement, or leave them as they are — ` +
      `your saved choice is untouched and returns automatically when ` +
      `${label} is topped up.`,
    keyboard,
  );

  await createAuditEntry({
    entityType: "ai_provider",
    entityId: provider,
    action: "update",
    performedBy: "system",
    newValue: {
      state: "out_of_credit",
      affectedTiers: tiers,
      triggeringTier,
    },
  }).catch((err) => console.error("[provider-alert] audit entry failed:", err));
}

/**
 * The recovery DM.
 *
 * Lists only the tiers that still select this provider — exactly the set that
 * just moved back. A tier an admin repointed during the outage is not listed:
 * its setting names another model now, nothing moved, and saying otherwise
 * would be false. If every affected tier was repointed, no call ever probes
 * this provider, so this function is never reached at all.
 */
export async function notifyAdminsOfProviderRecovery(
  provider: AiProvider,
): Promise<void> {
  const label = PROVIDER_LABELS[provider];
  const restored = tiersSelecting(provider, await currentSelection());

  const detail =
    restored.length > 0
      ? `${restored.map((t) => `<b>${t}</b>`).join(" and ")} ` +
        `${restored.length === 1 ? "has" : "have"} returned to it.`
      : "No tier is currently pointed at it.";

  await dmAdmins(`✅ <b>${label} is back in rotation.</b>\n${detail}`);

  await createAuditEntry({
    entityType: "ai_provider",
    entityId: provider,
    action: "update",
    performedBy: "system",
    newValue: { state: "healthy", restoredTiers: restored },
  }).catch((err) => console.error("[provider-alert] audit entry failed:", err));
}
