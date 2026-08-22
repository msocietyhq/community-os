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
  type SettingGroup,
  type SettingKey,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import type { DriftedChange, SettingsDraft } from "./settings-draft";
import { escapeHtml } from "./telegram-html";

export interface RenderedPage {
  text: string;
  keyboard: InlineKeyboardMarkup;
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


// ── Index ───────────────────────────────────────────────────

export function renderIndexPage(
  group: SettingGroup,
  snapshot: SettingsSnapshot,
): RenderedPage {
  const index = SETTING_GROUPS.indexOf(group);
  const prev =
    SETTING_GROUPS[(index - 1 + SETTING_GROUPS.length) % SETTING_GROUPS.length]!;
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

  // Italic values in ordinary text rather than an aligned <pre> table:
  // Telegram doesn't parse entities inside <pre>, so alignment and italics are
  // mutually exclusive, and the italics read better.
  const rows = keys
    .map(
      (key) =>
        `${escapeHtml(BOT_SETTINGS[key].label)} — <i>${escapeHtml(indexValue(key, snapshot))}</i>`,
    )
    .join("\n");

  const text =
    `⚙️ <b>Bot Settings · ${SETTING_GROUP_LABELS[group]}</b>  ` +
    `<i>${index + 1}/${SETTING_GROUPS.length}</i>\n\n` +
    `${rows}`;

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
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

export function renderSettingPage(
  key: SettingKey,
  snapshot: SettingsSnapshot,
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
      : `${changed.at.toISOString().slice(0, 10)}${changed.by ? "" : " (system)"}`;

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
    `Current:  <i>${escapeHtml(display(key, snapshot))}</i>\n` +
    `Default:  <i>${escapeHtml(formatValue(key, def.default))}</i>\n` +
    `Changed:  <i>${escapeHtml(changedLine)}</i>`;

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
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
    `<i>${escapeHtml(formatValue(change.key, change.from))}</i>` +
    `  →  ` +
    `<i>${escapeHtml(formatValue(change.key, change.to))}</i>`;

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
}

// ── Draft card ──────────────────────────────────────────────

function line(key: string, from: unknown, to: unknown): string {
  const settingKey = key as SettingKey;
  const def = BOT_SETTINGS[settingKey];
  if (!def) return escapeHtml(`${key}: ?`);
  return (
    `${escapeHtml(def.label)}: ` +
    `<i>${escapeHtml(formatValue(settingKey, from))}</i> → ` +
    `<i>${escapeHtml(formatValue(settingKey, to))}</i>`
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

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
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

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
}
