import { InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import {
  ADVISOR_TIER_LIMITS,
  BOT_SETTINGS,
  DM_ACCESS_LEVELS,
  SETTING_GROUPS,
  SETTING_GROUP_LABELS,
  callbackFor,
  keysInGroup,
  previewText,
  type SettingGroup,
  type SettingKey,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import {
  AI_CATALOG,
  AI_TIERS,
  modelKeysForTier,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import type { DriftedChange, SettingsDraft } from "./settings-draft";
import { escapeHtml } from "./telegram-html";

export interface RenderedPage {
  text: string;
  keyboard: InlineKeyboardMarkup;
  /**
   * Carried on the page so a call site cannot send it with the wrong mode.
   * These renderers emit HTML; a draft card once shipped with `Markdown` and
   * showed an admin raw `<b>` tags, because the sender lived in a different
   * file from the renderer and drifted.
   */
  parseMode: "HTML";
}

/** Every renderer returns through here, so the parse mode is never forgotten. */
function page(text: string, keyboard: InlineKeyboard): RenderedPage {
  return {
    text,
    keyboard: { inline_keyboard: keyboard.inline_keyboard },
    parseMode: "HTML",
  };
}

/**
 * Each registry entry's `format` is typed to its own value. Across the key
 * union that collapses to an uncallable intersection, so the narrowing happens
 * once here rather than at every call site.
 */
function formatValue(key: SettingKey, value: unknown): string {
  const format = BOT_SETTINGS[key].format as (v: unknown) => string;
  return format(value);
}

/**
 * A setting value, rendered as the literal it is.
 *
 * `<code>` rather than italics: a cap, a model id, a time range is a value to
 * be read exactly, not prose to be emphasised — and the monospace run makes a
 * `from → to` pair scan as one thing. Italics stay for what is genuinely
 * commentary: the rationale, the "via AI" tag, the page counter.
 */
function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

function display(key: SettingKey, snapshot: SettingsSnapshot): string {
  return formatValue(key, snapshot[key]);
}

/**
 * The value as it appears on the index page.
 *
 * Text settings collapse to default/custom/silent rather than a content
 * preview: a welcome template runs to 52 characters, which swamped the line
 * and made the list ragged. The full text is one tap away on the setting's
 * own page.
 */
function indexValue(key: SettingKey, snapshot: SettingsSnapshot): string {
  const def = BOT_SETTINGS[key];
  if (def.control !== "text") return formatValue(key, snapshot[key]);

  const value = snapshot[key];
  if (value === null) return "silent";
  return value === def.default ? "default" : "custom";
}

/**
 * A date as an admin reads it, in the community's timezone.
 *
 * ISO (`2026-08-22`) is what the history page shipped with; it is also UTC,
 * so a late-evening change in Singapore was filed under the previous day. The
 * year stays on because an audit trail is exactly where a bare "22 Aug" stops
 * being unambiguous.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDay(at: Date | null): string {
  return at ? DAY_FORMAT.format(at) : "unknown date";
}

// ── Index ───────────────────────────────────────────────────

export function renderIndexPage(
  group: SettingGroup,
  snapshot: SettingsSnapshot,
): RenderedPage {
  const index = SETTING_GROUPS.indexOf(group);
  const prev =
    SETTING_GROUPS[
      (index - 1 + SETTING_GROUPS.length) % SETTING_GROUPS.length
    ]!;
  const next = SETTING_GROUPS[(index + 1) % SETTING_GROUPS.length]!;

  const keys = keysInGroup(group);

  // Values live in the message body, not the button labels: a button carries
  // no formatting at all, and a long welcome-text preview on a label made
  // every button a different width. Two per row halves the vertical sprawl.
  const keyboard = new InlineKeyboard();
  keys.forEach((key, i) => {
    keyboard.text(BOT_SETTINGS[key].label, callbackFor("view", key));
    if (i % 2 === 1) keyboard.row();
  });
  if (keys.length % 2 === 1) keyboard.row();

  keyboard
    .text(`‹ ${SETTING_GROUP_LABELS[prev]}`, `set:idx:${prev}`)
    .text(`${SETTING_GROUP_LABELS[next]} ›`, `set:idx:${next}`)
    .row()
    .text("Recent changes", "set:hist::0");

  // Values in ordinary text rather than an aligned <pre> table: Telegram
  // doesn't parse entities inside <pre>, so alignment and per-value markup are
  // mutually exclusive, and the marked-up values read better.
  const rows = keys
    .map(
      (key) =>
        `${escapeHtml(BOT_SETTINGS[key].label)} — ${code(indexValue(key, snapshot))}`,
    )
    .join("\n");

  const text =
    `⚙️ <b>Bot Settings · ${SETTING_GROUP_LABELS[group]}</b>  ` +
    `<i>${index + 1}/${SETTING_GROUPS.length}</i>\n\n` +
    `${rows}`;

  return page(text, keyboard);
}

// ── Setting page ────────────────────────────────────────────

export interface PausePreset {
  label: string;
  /** Minutes, or null for indefinite. */
  minutes: number | null;
}

export const PAUSE_PRESETS: PausePreset[] = [
  { label: "Pause 1h", minutes: 60 },
  { label: "Pause 4h", minutes: 240 },
  { label: "Pause 24h", minutes: 1440 },
  { label: "Pause indefinitely", minutes: null },
];

const COOLDOWN_PRESETS = [0, 15, 30, 60, 180];
const CONFIDENCE_PRESETS = [0.6, 0.7, 0.8, 0.9, 0.95];
const MONEY_PRESETS: Partial<Record<SettingKey, (number | null)[]>> = {
  "cost.dailyCapUsd": [2, 5, 10, 25, null],
  "cost.monthlyCapUsd": [15, 30, 60, 120, null],
  "cost.advisorDailyBudgetUsd": [0.1, 0.25, 0.5, 1, 2],
  "cost.alertThresholdUsd": [1, 2, 5, 10, null],
};

const QUIET_HOUR_PRESETS = ["off", "23:00-07:00", "22:00-08:00"];

/**
 * Encodes a value into callback data. Only used for non-text controls — text
 * values go through the edit conversation, since a welcome template exceeds
 * Telegram's whole 64-byte callback budget on its own.
 */
function editCallback(key: SettingKey, value: string): string {
  return callbackFor("edit", key, value);
}

/** `ai.model.fast` → `fast`, or null for any other key. */
function tierOf(key: SettingKey): AiTier | null {
  const suffix = key.startsWith("ai.model.")
    ? key.slice("ai.model.".length)
    : null;
  return AI_TIERS.find((t) => t === suffix) ?? null;
}

export function renderSettingPage(
  key: SettingKey,
  snapshot: SettingsSnapshot,
  /** `by` is the actor's display name; null means no recorded actor. */
  changed: { by: string | null; at: Date | null } | null,
): RenderedPage {
  const def = BOT_SETTINGS[key];
  const keyboard = new InlineKeyboard();

  switch (def.control) {
    case "pause": {
      for (const preset of PAUSE_PRESETS) {
        keyboard.text(
          preset.label,
          editCallback(
            key,
            preset.minutes === null ? "inf" : String(preset.minutes),
          ),
        );
        if (preset.minutes === 240) keyboard.row();
      }
      keyboard.row().text("Resume now", editCallback(key, "0")).row();
      break;
    }
    case "toggle": {
      const on = snapshot[key] === true;
      keyboard
        .text(
          on ? "Turn off" : "Turn on",
          editCallback(key, on ? "false" : "true"),
        )
        .row();
      break;
    }
    case "choice": {
      const tier = tierOf(key);
      if (tier) {
        // Two per row: model labels are far wider than `everyone` or `off`,
        // and the catalog only grows.
        const modelKeys = modelKeysForTier(tier);
        modelKeys.forEach((modelKey, i) => {
          keyboard.text(
            AI_CATALOG[modelKey].label,
            editCallback(key, modelKey),
          );
          if (i % 2 === 1) keyboard.row();
        });
        if (modelKeys.length % 2 === 1) keyboard.row();
        break;
      }

      const options =
        key === "dm.access"
          ? [...DM_ACCESS_LEVELS]
          : key === "cost.advisorMaxTier"
            ? [...ADVISOR_TIER_LIMITS]
            : QUIET_HOUR_PRESETS;
      for (const option of options) {
        keyboard.text(option, editCallback(key, option));
      }
      keyboard.row();
      break;
    }
    case "duration": {
      for (const minutes of COOLDOWN_PRESETS) {
        keyboard.text(`${minutes}m`, editCallback(key, String(minutes)));
      }
      keyboard.row();
      break;
    }
    case "percent": {
      for (const value of CONFIDENCE_PRESETS) {
        keyboard.text(
          `${Math.round(value * 100)}%`,
          editCallback(key, String(value)),
        );
      }
      keyboard.row();
      break;
    }
    case "money": {
      for (const value of MONEY_PRESETS[key] ?? [1, 5, 10]) {
        keyboard.text(
          value === null ? "unlimited" : `$${value}`,
          editCallback(key, value === null ? "none" : String(value)),
        );
      }
      keyboard.row();
      break;
    }
    case "text": {
      keyboard.text("Edit", callbackFor("text", key));
      if (key.startsWith("welcome.")) {
        keyboard.text("Preview", callbackFor("prev", key));
      }
      keyboard.row();
      break;
    }
  }

  keyboard
    .text("Reset to default", callbackFor("reset", key))
    .text("History", callbackFor("hist", key, "0"))
    .row()
    .text("‹ Back", `set:idx:${def.group}`);

  const changedLine =
    changed?.at == null
      ? "never"
      : `${formatDay(changed.at)} · ${changed.by ?? "system"}`;

  // The full value for text settings, in a <pre> block. Entities aren't parsed
  // inside <pre>, so the admin's own markup shows as written rather than being
  // interpreted — which is what you want when editing a template.
  const body =
    def.control === "text"
      ? `\n<pre>${escapeHtml(String(snapshot[key] ?? "(silent)"))}</pre>\n`
      : "";

  const text =
    `<b>${escapeHtml(def.label)}</b>\n\n` +
    `${escapeHtml(def.description)}\n${body}\n` +
    `Current:  ${code(display(key, snapshot))}\n` +
    `Default:  ${code(formatValue(key, def.default))}\n` +
    `Changed:  <i>${escapeHtml(changedLine)}</i>`;

  return page(text, keyboard);
}

// ── Confirmation ────────────────────────────────────────────

export function renderConfirmation(change: {
  key: SettingKey;
  from: unknown;
  to: unknown;
}): RenderedPage {
  const def = BOT_SETTINGS[change.key];
  const keyboard = new InlineKeyboard()
    .text("Undo", callbackFor("undo", change.key))
    .text("‹ Settings", `set:idx:${def.group}`);

  const text =
    `✓ <b>Updated — ${escapeHtml(def.label)}</b>\n\n` +
    `${code(formatValue(change.key, change.from))}` +
    `  →  ` +
    `${code(formatValue(change.key, change.to))}`;

  return page(text, keyboard);
}

// ── Draft card ──────────────────────────────────────────────

function line(key: string, from: unknown, to: unknown): string {
  const settingKey = key as SettingKey;
  const def = BOT_SETTINGS[settingKey];
  if (!def) return escapeHtml(`${key}: ?`);
  return (
    `${escapeHtml(def.label)}: ` +
    `${code(formatValue(settingKey, from))} → ` +
    `${code(formatValue(settingKey, to))}`
  );
}

export function renderDraftCard(
  draft: SettingsDraft,
  drifted: DriftedChange[],
): RenderedPage {
  const driftedKeys = new Set(drifted.map((d) => d.key));
  const keyboard = new InlineKeyboard();

  const rows = draft.changes.map((change) => {
    const marker = driftedKeys.has(change.key) ? "  ⚠️ changed since" : "";
    return `• ${line(change.key, change.from, change.to)}${marker}`;
  });

  draft.changes.forEach((change, index) => {
    const def = BOT_SETTINGS[change.key as SettingKey];
    keyboard.text(`✕ ${def?.label ?? change.key}`, `set:draft:drop:${index}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row();

  const canConfirm = draft.changes.length > 0 && drifted.length === 0;
  if (canConfirm) keyboard.text("✓ Confirm all", "set:draft:confirm");
  keyboard.text("Cancel", "set:draft:cancel");

  const header =
    draft.changes.length === 0
      ? "📝 <b>No changes left in this draft</b>"
      : `📝 <b>Proposed changes (${draft.changes.length})</b>`;

  const warning =
    drifted.length > 0
      ? `\n\n⚠️ Some of these changed since the draft was made. Ask me again to rebuild it.`
      : "";

  const rationale = draft.rationale
    ? `\n\n<i>"${escapeHtml(draft.rationale)}"</i>`
    : "";

  const text = `${header}\n\n${rows.join("\n")}${rationale}${warning}`;

  return page(text, keyboard);
}

export function renderApplied(
  changes: { key: string; from: unknown; to: unknown }[],
): RenderedPage {
  const keyboard = new InlineKeyboard()
    .text("Undo all", "set:draft:undo")
    .text("⚙️ Settings", "set:idx:availability");

  const rows = changes.map((c) => `• ${line(c.key, c.from, c.to)}  ✓`);
  const text =
    `✓ <b>Applied ${changes.length} change${changes.length === 1 ? "" : "s"}</b>\n\n` +
    rows.join("\n");

  return page(text, keyboard);
}

// ── History ─────────────────────────────────────────────────

/**
 * One audit row, in the shape the renderer needs.
 *
 * Declared structurally rather than imported from the settings service: a
 * `lib/` renderer must not reach up into `services/`. `HistoryEntry` there is
 * assignable to this.
 */
export interface HistoryRow {
  key: string;
  action: string;
  from: unknown;
  to: unknown;
  actor: { name: string } | null;
  at: Date | null;
}

/** Anything that isn't a value the registry still understands. */
function rawHistoricValue(value: unknown): string {
  if (value === null || value === undefined) return "unset";
  if (typeof value === "string") return previewText(value);
  return previewText(JSON.stringify(value));
}

/**
 * Formats a value read back out of the audit trail.
 *
 * A snapshot value has been through `buildSnapshot`, so `format` can trust it.
 * A historical one has not: it may be a shape from before a setting was
 * retyped, or name a model since dropped from the catalog — and that key's
 * `format` is `AI_CATALOG[v].label`, which throws on a missing entry. One row
 * like that would otherwise take down the whole page, so the value is
 * re-validated first and anything that fails falls back to its raw form.
 */
function formatHistoricValue(key: string, value: unknown): string {
  const def = BOT_SETTINGS[key as SettingKey];
  if (!def) return rawHistoricValue(value);

  const parsed = def.schema.safeParse(value);
  if (!parsed.success) return rawHistoricValue(value);

  // A text setting's own `format` collapses to "custom", which as a history
  // line reads "custom → custom" and answers nothing. The whole point of the
  // line is what changed, so preview the text itself.
  if (def.control === "text") {
    return parsed.data === null ? "silent" : rawHistoricValue(parsed.data);
  }

  try {
    return formatValue(key as SettingKey, parsed.data);
  } catch {
    return rawHistoricValue(value);
  }
}

interface HistoryGroup {
  /** Display name, or null for a change with no recorded actor. */
  actor: string | null;
  day: string;
  rows: HistoryRow[];
}

/**
 * Collapses consecutive rows by who made them and when.
 *
 * Only the attribution is shared, so only the attribution is hoisted — each
 * setting keeps its own line. A change the AI drafted is rendered exactly like
 * one made from the menu: an admin confirmed both, and the trail records the
 * settings that actually moved. Presenting a draft as a labelled bundle put
 * the AI's account of its own intent next to the facts, where it read as a
 * description of the change rather than as a claim made before it.
 *
 * Grouping is on the day rather than the timestamp because the day is what the
 * header shows; a group can never then claim a time its rows didn't happen at.
 */
function groupHistory(entries: HistoryRow[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];

  for (const entry of entries) {
    const day = formatDay(entry.at);
    const last = groups.at(-1);

    if (
      last &&
      last.day === day &&
      last.actor === (entry.actor?.name ?? null)
    ) {
      last.rows.push(entry);
      continue;
    }

    groups.push({ actor: entry.actor?.name ?? null, day, rows: [entry] });
  }

  return groups;
}

function historyRowLine(row: HistoryRow): string {
  const def = BOT_SETTINGS[row.key as SettingKey];
  const label = def?.label ?? row.key;

  // "update" is the overwhelming majority and adds nothing next to an arrow
  // that already shows the update. A reset or an undo is worth calling out.
  const action =
    row.action === "update" ? "" : ` <i>(${escapeHtml(row.action)})</i>`;

  return (
    `• ${escapeHtml(label)}${action}  ` +
    `${code(formatHistoricValue(row.key, row.from))} → ` +
    `${code(formatHistoricValue(row.key, row.to))}`
  );
}

function historyGroupBlock(group: HistoryGroup): string {
  // Capped: an actor's name falls back to the Telegram display name when
  // there is no handle, and that is whatever the member typed into their
  // profile — emoji, padding and all.
  const actor = previewText(group.actor ?? "system", 32);
  const header = `<b>${escapeHtml(group.day)}</b> · ${escapeHtml(actor)}`;

  return `${header}\n${group.rows.map(historyRowLine).join("\n")}`;
}

/**
 * Telegram rejects a message over this outright — the admin gets nothing, not
 * a clipped list — and it counts the text *after* entities are parsed, so the
 * markup itself is free.
 */
const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Length as Telegram counts it: the markup this file emits doesn't count.
 *
 * Every tag a renderer here can emit has to be listed — a tag left out is
 * counted as visible text, and the page budget then trims entries that would
 * have fitted.
 */
function visibleLength(html: string): number {
  return html.replace(/<\/?(?:b|i|code)>/g, "").length;
}

/**
 * Entries per page — the same twenty the flat list showed.
 *
 * Grouped, an entry is taller than the single line it used to be: twenty
 * typical ones come to about 570 characters, but twenty at their worst (a
 * padded display name, two truncated templates each) come to roughly 4750 and
 * would lose the whole message rather than the overflow. The budget below is
 * what makes twenty safe — it stops filling the page early and `Older` resumes
 * from exactly where it stopped, so a pathological run costs a tap, not an
 * entry.
 */
export const HISTORY_PAGE_SIZE = 20;

const HISTORY_HEADING = "🕘 <b>Recent changes</b>";

export function renderHistoryPage(
  /**
   * Up to `HISTORY_PAGE_SIZE + 1` entries. The extra one is never rendered —
   * it exists so the renderer knows a next page is there without a count
   * query.
   */
  entries: HistoryRow[],
  key: SettingKey | null,
  offset = 0,
): RenderedPage {
  const keyboard = new InlineKeyboard();

  if (entries.length === 0) {
    backButton(keyboard, key);
    return page(`${HISTORY_HEADING}\n\nNo changes recorded yet.`, keyboard);
  }

  const blocks: string[] = [];
  let used = visibleLength(HISTORY_HEADING) + 2;
  let shown = 0;

  for (const group of groupHistory(entries.slice(0, HISTORY_PAGE_SIZE))) {
    const block = historyGroupBlock(group);
    const cost = visibleLength(block) + (blocks.length === 0 ? 0 : 2);

    // The first group goes on regardless: a page that dropped its only group
    // would leave `Older` pointing at the offset it is already on, and an
    // entry no navigation could ever reach.
    if (blocks.length > 0 && used + cost > TELEGRAM_TEXT_LIMIT) break;

    used += cost;
    blocks.push(block);
    shown += group.rows.length;
  }

  const hasMore = entries.length > shown;
  const paginated = hasMore || offset > 0;

  const jumpTo = (to: number) => callbackFor("hist", key ?? "", String(to));

  if (offset > 0) {
    keyboard.text("‹ Newer", jumpTo(Math.max(0, offset - HISTORY_PAGE_SIZE)));
  }
  if (hasMore) {
    keyboard.text("Older ›", jumpTo(offset + shown));
  }
  if (paginated) keyboard.row();
  backButton(keyboard, key);

  // The range replaces a page count: knowing the total would cost a second
  // COUNT query on every tap, and "11–20" answers the same question.
  const range = paginated ? `  <i>${offset + 1}–${offset + shown}</i>` : "";

  return page(`${HISTORY_HEADING}${range}\n\n${blocks.join("\n\n")}`, keyboard);
}

function backButton(keyboard: InlineKeyboard, key: SettingKey | null): void {
  if (key) {
    keyboard.text("‹ Back", callbackFor("view", key));
  } else {
    keyboard.text("‹ Settings", "set:idx:availability");
  }
}
