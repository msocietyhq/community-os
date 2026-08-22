import { z } from "zod";
import type { Role } from "./constants";

export const SETTING_GROUPS = [
  "availability",
  "cost",
  "behaviour",
  "welcome",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  availability: "Availability",
  cost: "Cost",
  behaviour: "Behaviour",
  welcome: "Welcome",
};

/** Tells the menu how to render the value editor for a setting. */
export type ControlKind =
  | "pause"
  | "toggle"
  | "money"
  | "duration"
  | "percent"
  | "choice"
  | "text";

export interface SettingDef<T> {
  schema: z.ZodType<T>;
  default: T;
  label: string;
  /** One or two sentences. Shown on the setting's page and given to the AI. */
  description: string;
  group: SettingGroup;
  control: ControlKind;
  /** Human-readable current value, e.g. "$0.50/day". */
  format: (v: T) => string;
  /** Minimum role that may change this. Defaults to "admin". */
  minRole?: Role;
}

/**
 * Identity helper so each entry is checked against SettingDef<T> while keeping
 * its exact T inferred. A `satisfies` constraint would need a variance escape
 * hatch, and `any` is banned repo-wide.
 */
const def = <T>(d: SettingDef<T>): SettingDef<T> => d;

// ── Pause state ─────────────────────────────────────────────

/**
 * Pause is a state rather than a boolean plus a timer: `paused_until` expires
 * by comparison at read time, so there is no cron to run and it survives a
 * restart. `z.coerce.date()` matters — jsonb round-trips a Date as an ISO
 * string, so the value read back is not the value written.
 */
export const pauseStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active") }),
  z.object({ state: z.literal("paused") }),
  z.object({ state: z.literal("paused_until"), until: z.coerce.date() }),
]);
export type PauseState = z.infer<typeof pauseStateSchema>;

export function isPaused(state: PauseState, now: Date): boolean {
  if (state.state === "active") return false;
  if (state.state === "paused") return true;
  return state.until.getTime() > now.getTime();
}

function formatPause(state: PauseState): string {
  if (state.state === "active") return "active";
  if (state.state === "paused") return "paused";
  const time = state.until.toLocaleString("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `paused until ${time} SGT`;
}

// ── Quiet hours ─────────────────────────────────────────────

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const quietHoursSchema = z
  .object({
    start: z.string().regex(HH_MM, "must be HH:MM"),
    end: z.string().regex(HH_MM, "must be HH:MM"),
  })
  .nullable();
export type QuietHours = z.infer<typeof quietHoursSchema>;

export const DM_ACCESS_LEVELS = ["everyone", "members", "admins"] as const;
export type DmAccessLevel = (typeof DM_ACCESS_LEVELS)[number];

export const ADVISOR_TIER_LIMITS = ["off", "big", "bigger"] as const;
export type AdvisorTierLimit = (typeof ADVISOR_TIER_LIMITS)[number];

const money = (v: number | null) => (v === null ? "unlimited" : `$${v}`);
const onOff = (v: boolean) => (v ? "on" : "off");

// ── Defaults lifted from the current hardcoded copy ──────────

export const DEFAULT_WELCOME_TEXT = `Welcome to MSOCIETY, {name}! 👋

Would you mind doing a short intro?
1. Some background of your academics
2. Your current job/situation
3. Your tech interests/aspirations`;

export const DEFAULT_RETURNING_TEXT = `Welcome back, {name}! 👋`;

export const DEFAULT_MAINTENANCE_REPLY =
  "I'm paused right now — I'll be back shortly.";
export const DEFAULT_DENIED_REPLY = "This bot is for MSOCIETY members.";

// ── The registry ────────────────────────────────────────────

export const BOT_SETTINGS = {
  // ── availability ──
  "ai.replies": def<PauseState>({
    schema: pauseStateSchema,
    default: { state: "active" },
    label: "AI replies",
    description:
      "Whether the bot answers members in chat. Commands (/events, /login) keep working either way. Background jobs are a separate switch.",
    group: "availability",
    control: "pause",
    format: formatPause,
  }),
  "ai.background": def<PauseState>({
    schema: pauseStateSchema,
    default: { state: "active" },
    label: "Background AI",
    description:
      "Whether scheduled and background AI runs — tech news, digests, profile regeneration, memory extraction — are allowed to spend.",
    group: "availability",
    control: "pause",
    format: formatPause,
  }),
  "availability.quietHours": def<QuietHours>({
    schema: quietHoursSchema,
    default: null,
    label: "Quiet hours",
    description:
      "A window (Singapore time) where the bot will not chime in uninvited. Direct questions are still answered — this only stops it volunteering. May wrap midnight.",
    group: "availability",
    control: "choice",
    format: (v) => (v === null ? "off" : `${v.start}–${v.end} SGT`),
  }),
  "dm.access": def<DmAccessLevel>({
    schema: z.enum(DM_ACCESS_LEVELS),
    default: "everyone",
    label: "DM access",
    description:
      "Who may use the bot in a direct message, including commands. Hierarchical: everyone, then members only, then admins only. Admins always get through.",
    group: "availability",
    control: "choice",
    format: (v) => v,
  }),
  "dm.maintenanceReply": def<string | null>({
    schema: z.string().max(500).nullable(),
    default: DEFAULT_MAINTENANCE_REPLY,
    label: "Paused reply",
    description:
      "Sent in a DM when AI replies are paused. Set to nothing for silence. Rate-limited to once per person per 10 minutes.",
    group: "availability",
    control: "text",
    format: (v) => (v === null ? "silent" : "custom"),
  }),
  "dm.deniedReply": def<string | null>({
    schema: z.string().max(500).nullable(),
    default: DEFAULT_DENIED_REPLY,
    label: "Denied reply",
    description:
      "Sent in a DM to someone blocked by the DM access level. Set to nothing for silence. Rate-limited to once per person per 10 minutes.",
    group: "availability",
    control: "text",
    format: (v) => (v === null ? "silent" : "custom"),
  }),

  // ── cost ──
  "cost.dailyCapUsd": def<number | null>({
    schema: z.number().min(0).max(1000).nullable(),
    default: 10,
    label: "Community daily cap",
    description:
      "Total AI spend allowed across the whole community per UTC day. When reached, all AI calls stop until midnight UTC. Empty means unlimited.",
    group: "cost",
    control: "money",
    format: (v) => (v === null ? "unlimited" : `$${v}/day`),
  }),
  "cost.monthlyCapUsd": def<number | null>({
    schema: z.number().min(0).max(10000).nullable(),
    default: 150,
    label: "Community monthly cap",
    description:
      "Total AI spend allowed across the whole community per calendar month (UTC). Empty means unlimited.",
    group: "cost",
    control: "money",
    format: (v) => (v === null ? "unlimited" : `$${v}/mo`),
  }),
  "cost.advisorDailyBudgetUsd": def<number>({
    schema: z.number().min(0).max(50),
    default: 0.5,
    label: "Per-member advisor budget",
    description:
      "How much each member may spend per UTC day on the deep-reasoning escalation tiers. Roughly two Opus escalations at the default.",
    group: "cost",
    control: "money",
    format: (v) => `$${v}/day`,
  }),
  "cost.advisorMaxTier": def<AdvisorTierLimit>({
    schema: z.enum(ADVISOR_TIER_LIMITS),
    default: "bigger",
    label: "Max advisor tier",
    description:
      "The deepest reasoning tier members may escalate to. Set to off to disable escalation entirely — this is the panic button for a cost spike.",
    group: "cost",
    control: "choice",
    format: (v) => v,
  }),
  "cost.alertThresholdUsd": def<number | null>({
    schema: z.number().min(0).max(1000).nullable(),
    default: null,
    label: "Spend alert",
    description:
      "DM every admin once when the day's spend crosses this amount. A warning only — nothing is blocked. Empty disables the alert.",
    group: "cost",
    control: "money",
    format: money,
  }),

  // ── behaviour ──
  "chimeIn.enabled": def<boolean>({
    schema: z.boolean(),
    default: true,
    label: "Chime-ins",
    description:
      "Whether the bot answers questions in the group it was not addressed in. Three gates run first: a free pre-filter, a cooldown, then a Haiku judgement.",
    group: "behaviour",
    control: "toggle",
    format: onOff,
  }),
  "chimeIn.cooldownMinutes": def<number>({
    schema: z.number().min(0).max(1440),
    default: 30,
    label: "Chime-in cooldown",
    description:
      "Minimum gap between unprompted replies in a chat. Raise it if the bot feels intrusive; it is a hard limit no model can override.",
    group: "behaviour",
    control: "duration",
    format: (v) => `${v}m`,
  }),
  "chimeIn.minConfidence": def<number>({
    schema: z.number().min(0).max(1),
    default: 0.8,
    label: "Chime-in confidence",
    description:
      "How sure the judge must be that speaking up is welcome. Higher means the bot interrupts less. Below this threshold a yes becomes a no.",
    group: "behaviour",
    control: "percent",
    format: (v) => `${Math.round(v * 100)}%`,
  }),
  "memory.extractionEnabled": def<boolean>({
    schema: z.boolean(),
    default: true,
    label: "Memory extraction",
    description:
      "Whether the bot reads group messages to record durable facts about members. Turning it off stops new memories; existing ones are kept.",
    group: "behaviour",
    control: "toggle",
    format: onOff,
  }),
  "research.webEnabled": def<boolean>({
    schema: z.boolean(),
    default: true,
    label: "Web research",
    description:
      "Whether the bot may search the live web and read pages. Turning it off restricts it to community data and what it already knows.",
    group: "behaviour",
    control: "toggle",
    format: onOff,
  }),

  // ── welcome ──
  "welcome.enabled": def<boolean>({
    schema: z.boolean(),
    default: true,
    label: "Welcome messages",
    description:
      "Whether new joiners and returning members are greeted at all. Turning it off silences both messages.",
    group: "welcome",
    control: "toggle",
    format: onOff,
  }),
  "welcome.newMemberText": def<string>({
    schema: z.string().min(1).max(2000),
    default: DEFAULT_WELCOME_TEXT,
    label: "New member welcome",
    description:
      "Sent once when someone joins the group or first speaks. {name} becomes a tappable mention. Telegram HTML is allowed and checked by preview.",
    group: "welcome",
    control: "text",
    format: (v) => `${v.slice(0, 30)}…`,
  }),
  "welcome.returningText": def<string>({
    schema: z.string().min(1).max(2000),
    default: DEFAULT_RETURNING_TEXT,
    label: "Returning member welcome",
    description:
      "Sent when someone who previously left rejoins the group. Same placeholders as the new member welcome.",
    group: "welcome",
    control: "text",
    format: (v) => `${v.slice(0, 30)}…`,
  }),
  "welcome.showProfileButton": def<boolean>({
    schema: z.boolean(),
    default: true,
    label: "Profile button",
    description:
      "Whether the welcome message carries a Set up profile button linking into the bot.",
    group: "welcome",
    control: "toggle",
    format: onOff,
  }),
};

export type SettingKey = keyof typeof BOT_SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<
  (typeof BOT_SETTINGS)[K]["schema"]
>;
export type SettingsSnapshot = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(BOT_SETTINGS) as SettingKey[];

export function keysInGroup(group: SettingGroup): SettingKey[] {
  return SETTING_KEYS.filter((k) => BOT_SETTINGS[k].group === group);
}

export function isSettingKey(value: string): value is SettingKey {
  return value in BOT_SETTINGS;
}

/**
 * Builds a callback_data string. Telegram caps these at 64 bytes, which is
 * asserted for every registry key by bot-settings.test.ts.
 */
export function callbackFor(
  prefix: string,
  key: string,
  suffix?: string,
): string {
  return suffix === undefined
    ? `set:${prefix}:${key}`
    : `set:${prefix}:${key}:${suffix}`;
}
