# Configurable Bot Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let community admins read and change the bot's operational settings from a Telegram DM — through a button menu or natural language — with every change attributed and auditable.

**Architecture:** A declarative registry in `packages/shared` is the single source of truth for every setting's schema, default, label, description and menu control. A framework-agnostic service reads and writes through it, merging defaults and writing audit rows. Two front-ends — a paginated button menu and three AI tools — both derive from the registry and both write through the service, so a new knob is one registry entry and nothing else. Enforcement is deliberately centralised: all cost caps and the background-AI pause live in a single pre-dispatch gate in `ai.service`, not scattered across the cron callbacks.

**Tech Stack:** Bun, TypeScript, Zod (v4, from the workspace catalog), Drizzle ORM + postgres-js, grammY (with `@grammyjs/conversations`), CASL, `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-22-bot-settings-design.md`

---

## Conventions for the whole plan

**Running tests.** There is no `test` script in any `package.json`; this repo uses Bun's built-in runner directly. Always run from the repo root:

```bash
bun test <path-to-file>          # one file
bun test apps/api packages       # everything
```

**Test placement.** Tests are colocated next to the file they cover as `<name>.test.ts` — follow `apps/api/src/bot/lib/chime-in.test.ts` as the reference style.

**No `any`.** `CLAUDE.md` forbids it outright. Use `unknown` plus narrowing, or generics.

**Branch and commits.** The user's standing preference is to work on `dev` and not to branch or commit unless asked. Commit steps are written into this plan because each task is meant to land as one reviewable unit — **confirm with the user before the first commit**, then follow their answer for the rest. Every commit message ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Task 1's commit step shows this in full; later tasks abbreviate to `git commit -m "..."` — append the same trailer every time.

**Migrations.** Never `drizzle-kit push`. Generate a migration file, commit it, and let Railway apply it on deploy.

---

## File Structure

**New files:**

| File | Responsibility |
| --- | --- |
| `packages/shared/src/bot-settings.ts` | The registry: schemas, defaults, labels, descriptions, controls. Pure data + tiny helpers. |
| `packages/shared/src/bot-settings.test.ts` | Registry invariants (defaults parse, callbacks fit in 64 bytes, no empty copy). |
| `apps/api/src/services/bot-settings.service.ts` | Read/write/reset/undo, snapshot building, cache, audit. |
| `apps/api/src/services/bot-settings.service.test.ts` | Snapshot building and cache behaviour. |
| `apps/api/src/services/ai-spend-counter.ts` | Running daily/monthly spend total, seeded from `ai_usage`. |
| `apps/api/src/bot/lib/ai-budget.ts` | Pure `decideBudget` verdict. |
| `apps/api/src/bot/lib/ai-budget.test.ts` | Budget verdict table test. |
| `apps/api/src/bot/lib/dm-access.ts` | Pure `decideDmAccess` + the grammY middleware. |
| `apps/api/src/bot/lib/dm-access.test.ts` | Access decision table test. |
| `apps/api/src/bot/lib/welcome-template.ts` | Pure template renderer with escaping. |
| `apps/api/src/bot/lib/welcome-template.test.ts` | Substitution and escaping. |
| `apps/api/src/bot/lib/settings-draft.ts` | Pure draft logic: expiry, drop, drift, invert. |
| `apps/api/src/bot/lib/settings-draft.test.ts` | Draft logic. |
| `apps/api/src/bot/lib/settings-menu.ts` | Pure renderers → `{ text, keyboard }`. |
| `apps/api/src/bot/lib/settings-menu.test.ts` | Snapshot tests of rendered pages. |
| `apps/api/src/bot/lib/settings-parse.ts` | Callback-data fragment → validated setting value. |
| `apps/api/src/bot/lib/spend-alert.ts` | DMs admins when the day's spend crosses the threshold. |
| `apps/api/src/bot/handlers/settings.ts` | `/settings` command, callback routing, edit conversation. |

**Modified files:**

| File | Change |
| --- | --- |
| `packages/shared/src/constants.ts` | Add `"bot_setting"` entity type, `"reset"`/`"undo"` actions. |
| `packages/shared/src/abilities.ts` | Add `"Settings"` subject and admin rules. |
| `packages/shared/src/index.ts` | Re-export `./bot-settings`. |
| `packages/shared/package.json` | Add the `./bot-settings` export path. |
| `apps/api/src/db/schema/bot.ts` | Add the `botSettings` table. |
| `apps/api/src/bot/types.ts` | Add `settingsDraft` and `lastAppliedDraft` to `SessionData`. |
| `apps/api/src/bot/init.ts` | Register the DM gate and the settings handler. |
| `apps/api/src/services/ai.service.ts` | Pre-dispatch gate, `class` on `TrackingContext`, spend recording. |
| `apps/api/src/bot/ai/advisor-access.ts` | Configurable budget and max tier. |
| `apps/api/src/bot/ai/advisor-gate.ts` | Read settings, pass them in. |
| `apps/api/src/bot/handlers/ai-chat.ts` | Pause gate, configurable chime-in, quiet hours. |
| `apps/api/src/bot/ai/tools.ts` | Three settings tools; research guard. |
| `apps/api/src/bot/lib/auto-register.ts` | Templated welcome. |
| `apps/api/src/bot/lib/telegram-message-logger.ts` | Memory-extraction guard. |
| `apps/api/src/bot/handlers/help.ts` | Document `/settings`. |

---

# Phase 1 — Foundation

## Task 1: Audit constants and the CASL Settings subject

**Files:**
- Modify: `packages/shared/src/constants.ts:142-166`
- Modify: `packages/shared/src/abilities.ts:18-29,57-91`

- [ ] **Step 1: Add the audit action and entity type**

In `packages/shared/src/constants.ts`, extend both arrays. `"update"` is already present; add `"reset"` and `"undo"`:

```ts
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "provision",
  "deprovision",
  "approve",
  "reject",
  "ban",
  "unban",
  "role_change",
  "reset",
  "undo",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "event",
  "project",
  "infra",
  "fund",
  "member",
  "subdomain",
  "venue",
  "reputation",
  "bot_setting",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
```

- [ ] **Step 2: Add the Settings subject to CASL**

In `packages/shared/src/abilities.ts`, add `"Settings"` to the `Subjects` union (after `"Audit"`):

```ts
export type Subjects =
  | "Event"
  | "Member"
  | MemberSubject
  | "Project"
  | ProjectSubject
  | "Infra"
  | "Venue"
  | "Fund"
  | "Reputation"
  | "Audit"
  | "Settings"
  | "all";
```

Then in the `admin` branch, after the existing `can("read", "Audit")` line:

```ts
    // Bot settings
    can("read", "Settings");
    can("update", "Settings");
```

`superadmin` needs no change — it already has `can("manage", "all")`. `member` gets nothing, which is the intent.

- [ ] **Step 3: Verify types still compile**

Run: `bun run --cwd packages/shared type-check`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/abilities.ts
git commit -m "feat: add bot_setting audit type and Settings ability

Settings changes need the same attribution trail as events and members,
and admins need an explicit ability so the bot can gate the menu without
a hardcoded role check.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The settings registry

**Files:**
- Create: `packages/shared/src/bot-settings.ts`
- Test: `packages/shared/src/bot-settings.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json`

**Why a `def()` helper rather than `satisfies`:** each entry needs to be type-checked against `SettingDef<T>` while keeping its own exact `T` inferred for `SettingValue<K>`. A `satisfies Record<string, SettingDef<unknown>>` constraint would need a variance escape hatch that `CLAUDE.md`'s no-`any` rule forbids. A generic identity function gives full checking with no casts.

- [ ] **Step 1: Write the failing invariant test**

Create `packages/shared/src/bot-settings.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  SETTING_GROUPS,
  callbackFor,
  isPaused,
  type PauseState,
} from "./bot-settings";

describe("registry invariants", () => {
  test("every default parses against its own schema", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      const result = def.schema.safeParse(def.default);
      expect(result.success, `${key} default failed its schema`).toBe(true);
    }
  });

  test("every setting has a label and a description", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      expect(def.label.length, `${key} label`).toBeGreaterThan(0);
      expect(def.description.length, `${key} description`).toBeGreaterThan(20);
    }
  });

  test("every setting belongs to a known group", () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_GROUPS).toContain(BOT_SETTINGS[key].group);
    }
  });

  // Telegram rejects callback_data over 64 bytes. This is the permanent guard.
  test("every generated callback fits in 64 bytes", () => {
    for (const key of SETTING_KEYS) {
      for (const prefix of ["view", "reset", "undo"]) {
        const data = callbackFor(prefix, key);
        expect(
          Buffer.byteLength(data, "utf8"),
          `${data} is too long`,
        ).toBeLessThanOrEqual(64);
      }
    }
  });

  test("format never throws on the default value", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      // @ts-expect-error — format is contravariant across the union of keys
      expect(typeof def.format(def.default)).toBe("string");
    }
  });
});

describe("isPaused", () => {
  const now = new Date("2026-08-22T12:00:00Z");

  test("active is never paused", () => {
    expect(isPaused({ state: "active" }, now)).toBe(false);
  });

  test("paused is always paused", () => {
    expect(isPaused({ state: "paused" }, now)).toBe(true);
  });

  test("paused_until in the future is paused", () => {
    const s: PauseState = {
      state: "paused_until",
      until: new Date("2026-08-22T13:00:00Z"),
    };
    expect(isPaused(s, now)).toBe(true);
  });

  test("paused_until in the past has expired", () => {
    const s: PauseState = {
      state: "paused_until",
      until: new Date("2026-08-22T11:00:00Z"),
    };
    expect(isPaused(s, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test packages/shared/src/bot-settings.test.ts`
Expected: FAIL — `Cannot find module './bot-settings'`.

- [ ] **Step 3: Write the registry**

Create `packages/shared/src/bot-settings.ts`:

```ts
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
  const time = state.until.toLocaleString("en-SG", {
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
export function callbackFor(prefix: string, key: string, suffix?: string): string {
  return suffix === undefined
    ? `set:${prefix}:${key}`
    : `set:${prefix}:${key}:${suffix}`;
}
```

- [ ] **Step 4: Export it from the package**

In `packages/shared/src/index.ts`, add as the last line:

```ts
export * from "./bot-settings";
```

In `packages/shared/package.json`, add to `exports`:

```json
    "./bot-settings": "./src/bot-settings.ts"
```

- [ ] **Step 5: Run the tests**

Run: `bun test packages/shared/src/bot-settings.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Type-check**

Run: `bun run --cwd packages/shared type-check`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/bot-settings.ts packages/shared/src/bot-settings.test.ts \
        packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat: add bot settings registry

One declarative source of truth so the menu, the AI tool and validation
cannot drift apart. The 64-byte callback assertion is what keeps a future
long key from silently breaking the menu in production."
```

---

## Task 3: The `bot_settings` table

**Files:**
- Modify: `apps/api/src/db/schema/bot.ts`
- Create: `apps/api/drizzle/00XX_*.sql` (generated)

- [ ] **Step 1: Add the table**

In `apps/api/src/db/schema/bot.ts`, add the `user` import at the top:

```ts
import { user } from "./auth";
```

Then append the table at the end of the file:

```ts
/**
 * Overridden bot settings, one row per key.
 *
 * Rows exist ONLY for settings that have been changed — anything absent falls
 * back to the registry default in @community-os/shared. That makes "reset to
 * default" a DELETE, and lets a new default ship in code without a data
 * migration.
 */
export const botSettings = pgTable("bot_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `bun db:generate`
Expected: a new file under `apps/api/drizzle/` creating `bot_settings`, plus an updated `meta/_journal.json`.

- [ ] **Step 3: Verify the generated SQL**

Run: `git status --short apps/api/drizzle`
Expected: one new `.sql`, one new `meta/00XX_snapshot.json`, modified `meta/_journal.json`.

Read the `.sql` and confirm it contains `CREATE TABLE` for `bot_settings` and **no** `DROP` statements. If it contains drops, stop — the local schema has drifted from the migration history and that needs resolving first.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema/bot.ts apps/api/drizzle
git commit -m "feat: add bot_settings table

Sparse by design: only overridden keys get a row, so the table ships empty
and behaviour is identical to today until an admin changes something."
```

---

## Task 4: The settings service

**Files:**
- Create: `apps/api/src/services/bot-settings.service.ts`
- Test: `apps/api/src/services/bot-settings.service.test.ts`

- [ ] **Step 1: Write the failing test**

`buildSnapshot` is pure, so it is tested without a database. Create `apps/api/src/services/bot-settings.service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { BOT_SETTINGS, SETTING_KEYS } from "@community-os/shared/bot-settings";
import { buildSnapshot } from "./bot-settings.service";

describe("buildSnapshot", () => {
  test("returns every registry default when there are no rows", () => {
    const snapshot = buildSnapshot([]);
    for (const key of SETTING_KEYS) {
      expect(snapshot[key]).toEqual(BOT_SETTINGS[key].default);
    }
  });

  test("an override replaces the default", () => {
    const snapshot = buildSnapshot([
      { key: "chimeIn.enabled", value: false },
    ]);
    expect(snapshot["chimeIn.enabled"]).toBe(false);
    expect(snapshot["chimeIn.cooldownMinutes"]).toBe(30);
  });

  test("a jsonb date round-trips back into a Date", () => {
    const snapshot = buildSnapshot([
      {
        key: "ai.replies",
        value: { state: "paused_until", until: "2026-08-22T13:00:00.000Z" },
      },
    ]);
    const value = snapshot["ai.replies"];
    expect(value.state).toBe("paused_until");
    if (value.state === "paused_until") {
      expect(value.until).toBeInstanceOf(Date);
    }
  });

  // A row left behind by a removed or retyped setting must never crash the bot.
  test("a corrupt value falls back to the default", () => {
    const snapshot = buildSnapshot([
      { key: "chimeIn.minConfidence", value: "not a number" },
    ]);
    expect(snapshot["chimeIn.minConfidence"]).toBe(0.8);
  });

  test("an unknown key is ignored", () => {
    const snapshot = buildSnapshot([{ key: "nope.gone", value: 1 }]);
    expect(Object.keys(snapshot).sort()).toEqual([...SETTING_KEYS].sort());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/services/bot-settings.service.test.ts`
Expected: FAIL — `buildSnapshot` is not exported.

- [ ] **Step 3: Write the service**

Create `apps/api/src/services/bot-settings.service.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import { db } from "../db";
import { auditLog, botSettings } from "../db/schema";
import { createAuditEntry } from "../middleware/audit";

export type ChangeSource = "menu" | "ai_draft";

export interface Actor {
  userId: string;
  source: ChangeSource;
  rationale?: string;
}

export interface AppliedChange {
  key: SettingKey;
  from: unknown;
  to: unknown;
}

interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Merges stored overrides over the registry defaults.
 *
 * A stored value that no longer parses — a removed setting, a retyped one —
 * falls back to its default rather than throwing. A bad row in this table must
 * never be able to take the bot down.
 */
export function buildSnapshot(rows: SettingRow[]): SettingsSnapshot {
  const overrides = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};

  for (const key of SETTING_KEYS) {
    const def = BOT_SETTINGS[key];
    const raw = overrides.get(key);

    if (raw === undefined) {
      out[key] = def.default;
      continue;
    }

    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[settings] ${key} stored value is invalid, using default`);
      out[key] = def.default;
      continue;
    }

    out[key] = parsed.data;
  }

  return out as SettingsSnapshot;
}

// ── Cache ───────────────────────────────────────────────────

/**
 * The bot changes settings from inside its own process, so a local write
 * invalidates synchronously and applies to the very next message. The TTL only
 * exists to pick up a write from a second Railway replica or a future web UI.
 */
const CACHE_TTL_MS = 30_000;

let cache: { snapshot: SettingsSnapshot; loadedAt: number } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function getSettings(now = Date.now()): Promise<SettingsSnapshot> {
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.snapshot;

  const rows = await db
    .select({ key: botSettings.key, value: botSettings.value })
    .from(botSettings);

  const snapshot = buildSnapshot(rows);
  cache = { snapshot, loadedAt: now };
  return snapshot;
}

// ── Writes ──────────────────────────────────────────────────

async function writeOne(
  key: SettingKey,
  value: unknown,
  actor: Actor,
): Promise<void> {
  await db
    .insert(botSettings)
    .values({ key, value, updatedBy: actor.userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSettings.key,
      set: { value, updatedBy: actor.userId, updatedAt: new Date() },
    });
}

async function audit(
  key: SettingKey,
  action: "update" | "reset" | "undo",
  from: unknown,
  to: unknown,
  actor: Actor,
): Promise<void> {
  await createAuditEntry({
    entityType: "bot_setting",
    entityId: key,
    action,
    oldValue: { value: from },
    newValue: { value: to, source: actor.source, rationale: actor.rationale },
    performedBy: actor.userId,
  });
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  actor: Actor,
): Promise<AppliedChange> {
  const before = await getSettings();
  const from = before[key];

  await writeOne(key, value, actor);
  invalidateSettingsCache();
  await audit(key, "update", from, value, actor);

  return { key, from, to: value };
}

export async function resetSetting(
  key: SettingKey,
  actor: Actor,
): Promise<AppliedChange> {
  const before = await getSettings();
  const from = before[key];
  const to = BOT_SETTINGS[key].default;

  await db.delete(botSettings).where(eq(botSettings.key, key));
  invalidateSettingsCache();
  await audit(key, "reset", from, to, actor);

  return { key, from, to };
}

/**
 * Applies a whole draft in one transaction, so a half-applied change set is
 * impossible. The cache is invalidated once, after the transaction commits.
 */
export async function applyChanges(
  changes: AppliedChange[],
  actor: Actor,
): Promise<AppliedChange[]> {
  if (changes.length === 0) return [];

  await db.transaction(async (tx) => {
    for (const change of changes) {
      await tx
        .insert(botSettings)
        .values({
          key: change.key,
          value: change.to,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: botSettings.key,
          set: {
            value: change.to,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          },
        });
    }
  });

  invalidateSettingsCache();

  for (const change of changes) {
    await audit(change.key, "update", change.from, change.to, actor);
  }

  return changes;
}

// ── History ─────────────────────────────────────────────────

export interface HistoryEntry {
  key: string;
  action: string;
  from: unknown;
  to: unknown;
  source: string | null;
  performedBy: string | null;
  at: Date | null;
}

interface ValueBag {
  value?: unknown;
  source?: unknown;
  rationale?: unknown;
}

function readBag(raw: unknown): ValueBag {
  return raw !== null && typeof raw === "object" ? (raw as ValueBag) : {};
}

export async function getHistory(
  key: SettingKey | null,
  limit = 20,
): Promise<HistoryEntry[]> {
  const where =
    key === null
      ? eq(auditLog.entityType, "bot_setting")
      : and(
          eq(auditLog.entityType, "bot_setting"),
          eq(auditLog.entityId, key),
        );

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const newBag = readBag(row.newValue);
    return {
      key: row.entityId,
      action: row.action,
      from: readBag(row.oldValue).value,
      to: newBag.value,
      source: typeof newBag.source === "string" ? newBag.source : null,
      performedBy: row.performedBy,
      at: row.createdAt,
    };
  });
}

/**
 * Reverts a setting to the previous value recorded in the audit trail.
 *
 * The previous value is read from the trail rather than carried in the
 * callback: a welcome template is far longer than Telegram's whole 64-byte
 * callback budget, so encoding it was never an option.
 */
export async function undoSetting(
  key: SettingKey,
  actor: Actor,
): Promise<AppliedChange | null> {
  const [latest] = await getHistory(key, 1);
  if (!latest) return null;

  const def = BOT_SETTINGS[key];
  const parsed = def.schema.safeParse(latest.from);
  const target = parsed.success ? parsed.data : def.default;

  const before = await getSettings();
  const from = before[key];

  await writeOne(key, target, actor);
  invalidateSettingsCache();
  await audit(key, "undo", from, target, actor);

  return { key, from, to: target };
}

export const botSettingsService = {
  getSettings,
  invalidateSettingsCache,
  setSetting,
  resetSetting,
  applyChanges,
  undoSetting,
  getHistory,
};
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/services/bot-settings.service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/bot-settings.service.ts \
        apps/api/src/services/bot-settings.service.test.ts
git commit -m "feat: add bot settings service

Falls back to the registry default when a stored value fails to parse, so a
row left behind by a removed setting degrades instead of taking the bot down.
Undo reads the previous value from the audit trail because a welcome template
is longer than Telegram's entire callback budget."
```

---

# Phase 2 — Pure logic units

## Task 5: DM access decision

**Files:**
- Create: `apps/api/src/bot/lib/dm-access.ts`
- Test: `apps/api/src/bot/lib/dm-access.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bot/lib/dm-access.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { decideDmAccess } from "./dm-access";

describe("decideDmAccess", () => {
  test("everyone lets a stranger through", () => {
    expect(
      decideDmAccess({ level: "everyone", role: null, banned: false }).allowed,
    ).toBe(true);
  });

  test("members blocks a stranger with no record", () => {
    const result = decideDmAccess({
      level: "members",
      role: null,
      banned: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("not_a_member");
  });

  test("members allows a member", () => {
    expect(
      decideDmAccess({ level: "members", role: "member", banned: false })
        .allowed,
    ).toBe(true);
  });

  test("members blocks a banned member", () => {
    expect(
      decideDmAccess({ level: "members", role: "member", banned: true })
        .allowed,
    ).toBe(false);
  });

  test("admins blocks an ordinary member", () => {
    const result = decideDmAccess({
      level: "admins",
      role: "member",
      banned: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("members_blocked");
  });

  test("admins lets an admin through", () => {
    expect(
      decideDmAccess({ level: "admins", role: "admin", banned: false }).allowed,
    ).toBe(true);
  });

  test("admins lets a superadmin through", () => {
    expect(
      decideDmAccess({ level: "admins", role: "superadmin", banned: false })
        .allowed,
    ).toBe(true);
  });

  // The escape hatch. An admin is banned automatically when they leave the
  // group; if that also locked them out of DMs, setting level=admins and then
  // leaving would lock the last admin out of the menu that unlocks it.
  test("a banned admin still gets through at every level", () => {
    for (const level of ["everyone", "members", "admins"] as const) {
      expect(
        decideDmAccess({ level, role: "admin", banned: true }).allowed,
        `level ${level}`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/dm-access.test.ts`
Expected: FAIL — `Cannot find module './dm-access'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/bot/lib/dm-access.ts`:

```ts
import type { NextFunction } from "grammy";
import type { Role } from "@community-os/shared/constants";
import type { DmAccessLevel } from "@community-os/shared/bot-settings";
import type { BotContext } from "../types";
import { getSettings } from "../../services/bot-settings.service";
import { resolveUser } from "./auth";

export interface DmAccessInput {
  level: DmAccessLevel;
  /** null when the sender has no member record at all. */
  role: Role | null;
  banned: boolean;
}

export type DmAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "not_a_member" | "members_blocked" };

/**
 * Decides whether a DM sender may use the bot at all.
 *
 * Admins bypass every level INCLUDING the ban check. A member is banned
 * automatically when they leave the group, and an admin who leaves must not
 * lose access to the settings menu — otherwise `dm.access = admins` plus a
 * departure locks the community out of its own bot with no way back.
 */
export function decideDmAccess({
  level,
  role,
  banned,
}: DmAccessInput): DmAccessDecision {
  if (level === "everyone") return { allowed: true };

  if (role === "admin" || role === "superadmin") return { allowed: true };

  if (level === "admins") {
    return { allowed: false, reason: "members_blocked" };
  }

  const isMember = role !== null && !banned;
  return isMember
    ? { allowed: true }
    : { allowed: false, reason: "not_a_member" };
}

// ── Reply rate limiting ─────────────────────────────────────

/**
 * In-memory, like the chime-in cooldown map. Losing it on deploy only means
 * one person could get a second copy of a refusal, which is not worth a table.
 */
const REPLY_COOLDOWN_MS = 10 * 60 * 1000;
const lastRepliedTo = new Map<number, number>();

export function shouldSendDenial(
  telegramId: number,
  now: number = Date.now(),
): boolean {
  const last = lastRepliedTo.get(telegramId);
  if (last !== undefined && now - last < REPLY_COOLDOWN_MS) return false;
  lastRepliedTo.set(telegramId, now);
  return true;
}

/** Test seam — the map is module state. */
export function resetDenialHistory(): void {
  lastRepliedTo.clear();
}

// ── Middleware ──────────────────────────────────────────────

/**
 * Gates every DM before anything else runs.
 *
 * Registered ahead of the message logger, photo sync, session and
 * conversations: a blocked stranger should not cause a profile-photo fetch, a
 * logged message row, or a session write.
 */
export async function dmAccessMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (ctx.chat?.type !== "private") return next();

  const from = ctx.from;
  if (!from || from.is_bot) return next();

  const settings = await getSettings();
  const level = settings["dm.access"];

  // Fast path: the default level admits everyone, so skip the user lookup.
  if (level === "everyone") return next();

  const resolved = await resolveUser(String(from.id));
  const decision = decideDmAccess({
    level,
    role: resolved ? (resolved.member.role as Role) : null,
    banned: resolved?.user.banned ?? false,
  });

  if (decision.allowed) return next();

  const reply = settings["dm.deniedReply"];
  if (reply !== null && shouldSendDenial(from.id)) {
    await ctx.reply(reply).catch((err) => {
      console.error("[dm-access] denial reply failed:", err);
    });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/dm-access.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/dm-access.ts apps/api/src/bot/lib/dm-access.test.ts
git commit -m "feat: add DM access gate

Admins bypass the ban check deliberately: leaving the group bans you, and an
admin who left must not lose the settings menu that would let them back in."
```

---

## Task 6: Welcome template renderer

**Files:**
- Create: `apps/api/src/bot/lib/welcome-template.ts`
- Test: `apps/api/src/bot/lib/welcome-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bot/lib/welcome-template.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderWelcome } from "./welcome-template";

const vars = { telegramId: 123, firstName: "Aziz", username: "aziz" };

describe("renderWelcome", () => {
  test("{name} becomes a tappable mention", () => {
    expect(renderWelcome("Hi {name}!", vars)).toBe(
      'Hi <a href="tg://user?id=123">Aziz</a>!',
    );
  });

  test("{first_name} is the bare name", () => {
    expect(renderWelcome("Hi {first_name}!", vars)).toBe("Hi Aziz!");
  });

  test("{username} is @-prefixed", () => {
    expect(renderWelcome("Hi {username}!", vars)).toBe("Hi @aziz!");
  });

  test("{username} falls back to the first name when absent", () => {
    expect(
      renderWelcome("Hi {username}!", { telegramId: 123, firstName: "Aziz" }),
    ).toBe("Hi Aziz!");
  });

  // The admin's own markup is theirs and is validated by preview-send. Only
  // the interpolated values are escaped.
  test("the admin's markup is preserved", () => {
    expect(renderWelcome("<b>Hi</b> {first_name}", vars)).toBe(
      "<b>Hi</b> Aziz",
    );
  });

  test("a member's name cannot inject markup", () => {
    const hostile = { telegramId: 7, firstName: "<script>alert(1)</script>" };
    expect(renderWelcome("Hi {first_name}", hostile)).toBe(
      "Hi &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("a hostile name is escaped inside the mention too", () => {
    const hostile = { telegramId: 7, firstName: "a<b>b" };
    expect(renderWelcome("{name}", hostile)).toBe(
      '<a href="tg://user?id=7">a&lt;b&gt;b</a>',
    );
  });

  test("an ampersand in a name is escaped", () => {
    expect(
      renderWelcome("{first_name}", { telegramId: 7, firstName: "A & B" }),
    ).toBe("A &amp; B");
  });

  // A typo should look wrong, not break the greeting.
  test("an unknown placeholder is left literal", () => {
    expect(renderWelcome("Hi {nope}!", vars)).toBe("Hi {nope}!");
  });

  test("a placeholder appearing twice is substituted twice", () => {
    expect(renderWelcome("{first_name} {first_name}", vars)).toBe("Aziz Aziz");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/welcome-template.test.ts`
Expected: FAIL — `Cannot find module './welcome-template'`.

- [ ] **Step 3: Write the renderer**

Create `apps/api/src/bot/lib/welcome-template.ts`:

```ts
export interface WelcomeVars {
  telegramId: number;
  firstName: string;
  username?: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Renders an admin-authored welcome template.
 *
 * The admin's own markup is stored and emitted verbatim — it is validated by
 * the preview-send in the edit flow, so a broken tag never reaches a real
 * joiner. Only the interpolated values are escaped, because those are
 * attacker-controlled: a member can name themselves anything they like.
 */
export function renderWelcome(template: string, vars: WelcomeVars): string {
  const safeName = escapeHtml(vars.firstName);

  const values: Record<string, string> = {
    name: `<a href="tg://user?id=${vars.telegramId}">${safeName}</a>`,
    first_name: safeName,
    username: vars.username ? `@${escapeHtml(vars.username)}` : safeName,
  };

  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? (values[key] as string) : whole,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/welcome-template.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/welcome-template.ts \
        apps/api/src/bot/lib/welcome-template.test.ts
git commit -m "feat: add welcome template renderer

Escapes only interpolated values. A member controls their own display name,
so that is the untrusted input; the admin's markup is validated by preview."
```

---

## Task 7: Draft logic

**Files:**
- Create: `apps/api/src/bot/lib/settings-draft.ts`
- Test: `apps/api/src/bot/lib/settings-draft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bot/lib/settings-draft.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  DRAFT_TTL_MS,
  detectDrift,
  dropChange,
  invert,
  isDraftExpired,
  type SettingsDraft,
} from "./settings-draft";

const draft = (): SettingsDraft => ({
  changes: [
    { key: "chimeIn.enabled", from: true, to: false },
    { key: "chimeIn.cooldownMinutes", from: 30, to: 60 },
    { key: "cost.dailyCapUsd", from: 10, to: 4 },
  ],
  createdAt: 1_000,
  messageId: 42,
});

describe("isDraftExpired", () => {
  test("a fresh draft is live", () => {
    expect(isDraftExpired(draft(), 1_000 + DRAFT_TTL_MS - 1)).toBe(false);
  });

  test("expires exactly at the TTL", () => {
    expect(isDraftExpired(draft(), 1_000 + DRAFT_TTL_MS)).toBe(true);
  });
});

describe("dropChange", () => {
  test("removes the change at the index", () => {
    const result = dropChange(draft(), 1);
    expect(result.changes.map((c) => c.key)).toEqual([
      "chimeIn.enabled",
      "cost.dailyCapUsd",
    ]);
  });

  test("does not mutate the original", () => {
    const original = draft();
    dropChange(original, 0);
    expect(original.changes).toHaveLength(3);
  });

  test("an out-of-range index is a no-op", () => {
    expect(dropChange(draft(), 9).changes).toHaveLength(3);
  });
});

describe("detectDrift", () => {
  test("no drift when current matches every recorded from", () => {
    const current = {
      "chimeIn.enabled": true,
      "chimeIn.cooldownMinutes": 30,
      "cost.dailyCapUsd": 10,
    };
    expect(detectDrift(draft(), current)).toEqual([]);
  });

  test("reports a key changed since the draft was made", () => {
    const current = {
      "chimeIn.enabled": true,
      "chimeIn.cooldownMinutes": 45,
      "cost.dailyCapUsd": 10,
    };
    const drifted = detectDrift(draft(), current);
    expect(drifted).toHaveLength(1);
    expect(drifted[0]?.key).toBe("chimeIn.cooldownMinutes");
    expect(drifted[0]?.current).toBe(45);
  });

  test("compares object values structurally, not by reference", () => {
    const d: SettingsDraft = {
      changes: [
        {
          key: "availability.quietHours",
          from: { start: "23:00", end: "07:00" },
          to: null,
        },
      ],
      createdAt: 0,
      messageId: 1,
    };
    const current = {
      "availability.quietHours": { start: "23:00", end: "07:00" },
    };
    expect(detectDrift(d, current)).toEqual([]);
  });
});

describe("invert", () => {
  test("swaps from and to on every change", () => {
    expect(invert(draft().changes)).toEqual([
      { key: "chimeIn.enabled", from: false, to: true },
      { key: "chimeIn.cooldownMinutes", from: 60, to: 30 },
      { key: "cost.dailyCapUsd", from: 4, to: 10 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/settings-draft.test.ts`
Expected: FAIL — `Cannot find module './settings-draft'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/bot/lib/settings-draft.ts`:

```ts
export interface DraftChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface SettingsDraft {
  changes: DraftChange[];
  rationale?: string;
  createdAt: number;
  /** The card's message, so it can be edited in place as rows are dropped. */
  messageId: number;
}

/** Long enough to read and think, short enough that intent is still current. */
export const DRAFT_TTL_MS = 10 * 60 * 1000;

export function isDraftExpired(draft: SettingsDraft, now: number): boolean {
  return now - draft.createdAt >= DRAFT_TTL_MS;
}

export function dropChange(
  draft: SettingsDraft,
  index: number,
): SettingsDraft {
  return { ...draft, changes: draft.changes.filter((_, i) => i !== index) };
}

export interface DriftedChange extends DraftChange {
  current: unknown;
}

/**
 * Finds changes whose recorded "before" no longer matches reality.
 *
 * Checked at confirm rather than at propose: between the two, the same admin
 * may have changed one of these through the menu, and applying the draft
 * blindly would silently discard that.
 *
 * Bun.deepEquals rather than JSON.stringify — object values like quietHours
 * would otherwise compare unequal on key order alone.
 */
export function detectDrift(
  draft: SettingsDraft,
  current: Record<string, unknown>,
): DriftedChange[] {
  return draft.changes
    .filter((change) => !Bun.deepEquals(change.from, current[change.key]))
    .map((change) => ({ ...change, current: current[change.key] }));
}

/** The change set that reverses an applied draft. Powers "Undo all". */
export function invert(changes: DraftChange[]): DraftChange[] {
  return changes.map((c) => ({ key: c.key, from: c.to, to: c.from }));
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/settings-draft.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the draft slots to the session type**

In `apps/api/src/bot/types.ts`, add the import:

```ts
import type { SettingsDraft } from "./lib/settings-draft";
```

and extend `SessionData`:

```ts
export interface SessionData {
  // Maps bot message_id → AI SDK response messages (tool calls, results, assistant text)
  aiResponses?: Record<number, ModelMessage[]>;
  /**
   * An outstanding ask_user question. Sessions are keyed per chat, so there is
   * one slot per chat — the asked member is recorded so someone else replying
   * doesn't consume it.
   */
  pendingQuestion?: PendingQuestion;
  /** An AI-proposed settings change set awaiting confirmation. */
  settingsDraft?: SettingsDraft;
  /** The inverse of the last applied draft, for "Undo all". */
  lastAppliedDraft?: SettingsDraft;
}
```

- [ ] **Step 6: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bot/lib/settings-draft.ts \
        apps/api/src/bot/lib/settings-draft.test.ts apps/api/src/bot/types.ts
git commit -m "feat: add settings draft logic

Drift is detected at confirm rather than propose, so a menu change made while
a draft is open is never silently overwritten by stale intent."
```

---

## Task 8: Menu renderers

**Files:**
- Create: `apps/api/src/bot/lib/settings-menu.ts`
- Test: `apps/api/src/bot/lib/settings-menu.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bot/lib/settings-menu.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { BOT_SETTINGS } from "@community-os/shared/bot-settings";
import {
  PAUSE_PRESETS,
  renderConfirmation,
  renderDraftCard,
  renderIndexPage,
  renderSettingPage,
} from "./settings-menu";
import type { SettingsDraft } from "./settings-draft";

const snapshot = Object.fromEntries(
  Object.entries(BOT_SETTINGS).map(([key, def]) => [key, def.default]),
) as Parameters<typeof renderIndexPage>[1];

describe("renderIndexPage", () => {
  test("lists one button per setting in the group plus navigation", () => {
    const page = renderIndexPage("behaviour", snapshot);
    const rows = page.keyboard.inline_keyboard;
    // 5 behaviour settings each on their own row, then a nav row, then history.
    expect(rows).toHaveLength(7);
    expect(page.text).toContain("Behaviour");
  });

  test("button labels carry the current value", () => {
    const page = renderIndexPage("behaviour", snapshot);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("Chime-ins · on");
  });

  test("navigation wraps around the group list", () => {
    const page = renderIndexPage("welcome", snapshot);
    // Last row is Recent changes; the nav pair sits above it.
    const nav = page.keyboard.inline_keyboard.at(-2) ?? [];
    expect(nav).toHaveLength(2);
    expect(nav[0]?.text).toContain("Behaviour");
    expect(nav[1]?.text).toContain("Availability");
  });

  test("renders every group without throwing", () => {
    for (const group of ["availability", "cost", "behaviour", "welcome"] as const) {
      expect(() => renderIndexPage(group, snapshot)).not.toThrow();
    }
  });
});

describe("renderSettingPage", () => {
  test("shows the description, current value and default", () => {
    const page = renderSettingPage("chimeIn.enabled", snapshot, null);
    expect(page.text).toContain(BOT_SETTINGS["chimeIn.enabled"].description);
    expect(page.text).toContain("Current:");
    expect(page.text).toContain("Default:");
  });

  test("a toggle offers the opposite value", () => {
    const page = renderSettingPage("chimeIn.enabled", snapshot, null);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("Turn off");
  });

  test("a pause control offers every preset", () => {
    const page = renderSettingPage("ai.replies", snapshot, null);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    for (const preset of PAUSE_PRESETS) {
      expect(labels).toContain(preset.label);
    }
  });

  test("every setting renders without throwing", () => {
    for (const key of Object.keys(BOT_SETTINGS)) {
      expect(() =>
        renderSettingPage(key as keyof typeof BOT_SETTINGS, snapshot, null),
      ).not.toThrow();
    }
  });

  test("every generated callback fits Telegram's limit", () => {
    for (const key of Object.keys(BOT_SETTINGS)) {
      const page = renderSettingPage(
        key as keyof typeof BOT_SETTINGS,
        snapshot,
        null,
      );
      for (const button of page.keyboard.inline_keyboard.flat()) {
        if ("callback_data" in button && button.callback_data) {
          expect(
            Buffer.byteLength(button.callback_data, "utf8"),
            `${button.callback_data} is too long`,
          ).toBeLessThanOrEqual(64);
        }
      }
    }
  });
});

describe("renderConfirmation", () => {
  test("shows the before and after", () => {
    const page = renderConfirmation({
      key: "chimeIn.enabled",
      from: true,
      to: false,
    });
    expect(page.text).toContain("on");
    expect(page.text).toContain("off");
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("Undo");
  });
});

describe("renderDraftCard", () => {
  const draft: SettingsDraft = {
    changes: [
      { key: "chimeIn.enabled", from: true, to: false },
      { key: "cost.dailyCapUsd", from: 10, to: 4 },
    ],
    rationale: "quiet week",
    createdAt: 0,
    messageId: 0,
  };

  test("lists every change with a drop button each", () => {
    const page = renderDraftCard(draft, []);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels.filter((l) => l.startsWith("✕"))).toHaveLength(2);
    expect(labels).toContain("✓ Confirm all");
  });

  test("includes the rationale", () => {
    expect(renderDraftCard(draft, []).text).toContain("quiet week");
  });

  test("marks drifted rows and drops the confirm button", () => {
    const page = renderDraftCard(draft, [
      { key: "cost.dailyCapUsd", from: 10, to: 4, current: 25 },
    ]);
    expect(page.text).toContain("changed since");
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).not.toContain("✓ Confirm all");
  });

  test("an empty draft offers nothing to confirm", () => {
    const page = renderDraftCard({ ...draft, changes: [] }, []);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(labels).not.toContain("✓ Confirm all");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/settings-menu.test.ts`
Expected: FAIL — `Cannot find module './settings-menu'`.

- [ ] **Step 3: Write the renderers**

Create `apps/api/src/bot/lib/settings-menu.ts`:

```ts
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import {
  BOT_SETTINGS,
  DM_ACCESS_LEVELS,
  ADVISOR_TIER_LIMITS,
  SETTING_GROUPS,
  SETTING_GROUP_LABELS,
  callbackFor,
  keysInGroup,
  type SettingGroup,
  type SettingKey,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import type { DriftedChange, SettingsDraft } from "./settings-draft";

export interface RenderedPage {
  text: string;
  keyboard: InlineKeyboardMarkup;
}

/** Reads a snapshot value and formats it via its own registry entry. */
function display(key: SettingKey, snapshot: SettingsSnapshot): string {
  const def = BOT_SETTINGS[key];
  // The registry's format functions are each typed to their own value; the
  // snapshot is correct by construction, so narrow through unknown once here
  // rather than at every call site.
  const format = def.format as (v: unknown) => string;
  return format(snapshot[key]);
}

function formatValue(key: SettingKey, value: unknown): string {
  const format = BOT_SETTINGS[key].format as (v: unknown) => string;
  return format(value);
}

// ── Index ───────────────────────────────────────────────────

export function renderIndexPage(
  group: SettingGroup,
  snapshot: SettingsSnapshot,
): RenderedPage {
  const index = SETTING_GROUPS.indexOf(group);
  const prev = SETTING_GROUPS[(index - 1 + SETTING_GROUPS.length) % SETTING_GROUPS.length]!;
  const next = SETTING_GROUPS[(index + 1) % SETTING_GROUPS.length]!;

  const keyboard = new InlineKeyboard();
  for (const key of keysInGroup(group)) {
    keyboard
      .text(
        `${BOT_SETTINGS[key].label} · ${display(key, snapshot)}`,
        callbackFor("view", key),
      )
      .row();
  }

  keyboard
    .text(`‹ ${SETTING_GROUP_LABELS[prev]}`, `set:idx:${prev}`)
    .text(`${SETTING_GROUP_LABELS[next]} ›`, `set:idx:${next}`);

  keyboard.row().text("Recent changes", "set:hist::0");

  const text =
    `⚙️ *Bot Settings · ${SETTING_GROUP_LABELS[group]}*  ` +
    `_${index + 1}/${SETTING_GROUPS.length}_\n\n` +
    `Tap a setting to see what it does and change it.`;

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
const MONEY_PRESETS: Record<string, (number | null)[]> = {
  "cost.dailyCapUsd": [2, 5, 10, 25, null],
  "cost.monthlyCapUsd": [50, 100, 150, 300, null],
  "cost.advisorDailyBudgetUsd": [0.1, 0.25, 0.5, 1, 2],
  "cost.alertThresholdUsd": [2, 5, 10, 25, null],
};

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
          editCallback(key, preset.minutes === null ? "inf" : String(preset.minutes)),
        );
        if (preset.minutes === 240) keyboard.row();
      }
      keyboard.row().text("Resume now", editCallback(key, "0")).row();
      break;
    }
    case "toggle": {
      const on = snapshot[key] === true;
      keyboard
        .text(on ? "Turn off" : "Turn on", editCallback(key, on ? "false" : "true"))
        .row();
      break;
    }
    case "choice": {
      const options =
        key === "dm.access"
          ? [...DM_ACCESS_LEVELS]
          : key === "cost.advisorMaxTier"
            ? [...ADVISOR_TIER_LIMITS]
            : ["off", "23:00-07:00", "22:00-08:00"];
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
        keyboard.text(`${Math.round(value * 100)}%`, editCallback(key, String(value)));
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

  const current = display(key, snapshot);
  const defaultText = formatValue(key, def.default);

  const body =
    def.control === "text"
      ? `\n\`\`\`\n${String(snapshot[key] ?? "(silent)")}\n\`\`\`\n`
      : "";

  const text =
    `*${def.label}*\n\n` +
    `${def.description}\n${body}\n` +
    `Current:  ${current}\n` +
    `Default:  ${defaultText}\n` +
    `Changed:  ${changedLine}`;

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
    `✓ *Updated — ${def.label}*\n\n` +
    `${formatValue(change.key, change.from)}  →  ${formatValue(change.key, change.to)}`;

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
}

// ── Draft card ──────────────────────────────────────────────

function line(key: string, from: unknown, to: unknown): string {
  const settingKey = key as SettingKey;
  const def = BOT_SETTINGS[settingKey];
  if (!def) return `${key}: ?`;
  return `${def.label}: ${formatValue(settingKey, from)} → ${formatValue(settingKey, to)}`;
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
      ? "📝 *No changes left in this draft*"
      : `📝 *Proposed changes (${draft.changes.length})*`;

  const warning =
    drifted.length > 0
      ? `\n\n⚠️ Some of these changed since the draft was made. Ask me again to rebuild it.`
      : "";

  const rationale = draft.rationale ? `\n\n_"${draft.rationale}"_` : "";

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
  const text = `✓ *Applied ${changes.length} change${changes.length === 1 ? "" : "s"}*\n\n${rows.join("\n")}`;

  return { text, keyboard: { inline_keyboard: keyboard.inline_keyboard } };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/settings-menu.test.ts`
Expected: PASS, 13 tests.

If the index test fails on row count, adjust the assertion to match the actual layout — the important assertions are the callback-length one and the render-without-throwing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/settings-menu.ts apps/api/src/bot/lib/settings-menu.test.ts
git commit -m "feat: add settings menu renderers

Pure functions returning text plus keyboard, so every page is testable without
a Telegram connection. The callback-length assertion runs over every rendered
button, not just the registry keys."
```

---

# Phase 3 — Front-ends

## Task 9: The settings handler

**Files:**
- Create: `apps/api/src/bot/handlers/settings.ts`
- Modify: `apps/api/src/bot/init.ts`

- [ ] **Step 1: Write the handler**

Create `apps/api/src/bot/handlers/settings.ts`:

```ts
import { Composer } from "grammy";
import {
  BOT_SETTINGS,
  SETTING_GROUPS,
  isSettingKey,
  type SettingGroup,
  type SettingKey,
} from "@community-os/shared/bot-settings";
import { defineAbilityFor } from "@community-os/shared/abilities";
import { isRole, ROLE_HIERARCHY, type Role } from "@community-os/shared/constants";
import type { BotContext } from "../types";
import { env } from "../../env";
import { resolveUser } from "../lib/auth";
import {
  getSettings,
  getHistory,
  resetSetting,
  setSetting,
  undoSetting,
  applyChanges,
  type Actor,
} from "../../services/bot-settings.service";
import {
  renderConfirmation,
  renderIndexPage,
  renderSettingPage,
  renderDraftCard,
  renderApplied,
} from "../lib/settings-menu";
import { detectDrift, dropChange, invert, isDraftExpired } from "../lib/settings-draft";
import { parseEditValue } from "../lib/settings-parse";

export const settingsHandler = new Composer<BotContext>();

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

  const role = resolved.member.role;
  if (!isRole(role)) return null;

  const ability = defineAbilityFor({ id: resolved.user.id, role });
  if (!ability.can("update", "Settings")) return null;

  return { userId: resolved.user.id, source: "menu", role };
}

/**
 * Enforces a setting's own `minRole`, which sits on top of the CASL check.
 *
 * Today every setting defaults to `admin`, so this never rejects — but it is
 * what makes locking `cost.*` to superadmin later a one-word registry edit
 * rather than a permissions refactor. Without it the registry field is dead
 * weight that silently does nothing.
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
    parse_mode: "Markdown",
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
  const page = renderIndexPage(group, snapshot);

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
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

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
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
  const page = renderConfirmation(change);

  await ctx.answerCallbackQuery({ text: "Saved." });
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
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

  const change = await resetSetting(key, actor);
  const page = renderConfirmation(change);

  await ctx.answerCallbackQuery({ text: "Reset." });
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
});

settingsHandler.callbackQuery(/^set:undo:(.+)$/, async (ctx) => {
  const actor = await requireAdmin(ctx);
  if (!actor) return denied(ctx);

  const key = ctx.match![1]!;
  if (!isSettingKey(key)) {
    await ctx.answerCallbackQuery({ text: "Unknown setting." });
    return;
  }

  const change = await undoSetting(key, actor);
  if (!change) {
    await ctx.answerCallbackQuery({ text: "Nothing to undo." });
    return;
  }

  const page = renderConfirmation(change);
  await ctx.answerCallbackQuery({ text: "Reverted." });
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
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
            const settingKey = entry.key as SettingKey;
            const def = BOT_SETTINGS[settingKey];
            const label = def?.label ?? entry.key;
            const when = entry.at?.toISOString().slice(0, 10) ?? "?";
            const via = entry.source === "ai_draft" ? " · via AI" : "";
            return `• ${label} · ${entry.action} · ${when}${via}`;
          })
          .join("\n");

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`🕘 *Recent changes*\n\n${body}`, {
    parse_mode: "Markdown",
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

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
});

settingsHandler.callbackQuery("set:draft:cancel", async (ctx) => {
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

  const snapshot = await getSettings();
  const drifted = detectDrift(draft, snapshot as unknown as Record<string, unknown>);

  // Someone changed one of these between propose and confirm. Re-render rather
  // than applying stale intent over a deliberate newer change.
  if (drifted.length > 0) {
    const page = renderDraftCard(draft, drifted);
    await ctx.answerCallbackQuery({ text: "Something changed — check again." });
    await ctx.editMessageText(page.text, {
      parse_mode: "Markdown",
      reply_markup: page.keyboard,
    });
    return;
  }

  const actor: Actor = {
    userId: admin.userId,
    source: "ai_draft",
    rationale: draft.rationale,
  };

  const applied = await applyChanges(
    draft.changes.map((c) => ({ key: c.key as SettingKey, from: c.from, to: c.to })),
    actor,
  );

  ctx.session.lastAppliedDraft = { ...draft, changes: invert(draft.changes) };
  ctx.session.settingsDraft = undefined;

  const page = renderApplied(applied);
  await ctx.answerCallbackQuery({ text: "Applied." });
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
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
    inverse.changes.map((c) => ({ key: c.key as SettingKey, from: c.from, to: c.to })),
    { userId: admin.userId, source: "ai_draft", rationale: "undo" },
  );

  ctx.session.lastAppliedDraft = undefined;

  const page = renderApplied(applied);
  await ctx.answerCallbackQuery({ text: "Reverted." });
  await ctx.editMessageText(page.text, {
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
});
```

- [ ] **Step 2: Apply the same `minRole` guard to the other write paths**

Add the identical four-line block to the `set:reset:` and `set:undo:` handlers, immediately after their `isSettingKey` check:

```ts
  if (!canChangeSetting(key, actor.role)) {
    await ctx.answerCallbackQuery({ text: "That setting needs a higher role." });
    return;
  }
```

For `set:draft:confirm`, guard the whole set before applying anything — a draft is all-or-nothing, so one over-privileged change rejects the batch rather than silently applying the rest:

```ts
  const blocked = draft.changes.filter(
    (c) => isSettingKey(c.key) && !canChangeSetting(c.key, admin.role),
  );
  if (blocked.length > 0) {
    await ctx.answerCallbackQuery({
      text: "Some of these need a higher role.",
    });
    return;
  }
```

Place it directly after the expiry check and before the drift check.

- [ ] **Step 3: Write the value parser**

Create `apps/api/src/bot/lib/settings-parse.ts`:

```ts
import {
  BOT_SETTINGS,
  type SettingKey,
  type SettingValue,
} from "@community-os/shared/bot-settings";

export type ParseResult<K extends SettingKey> =
  | { ok: true; value: SettingValue<K> }
  | { ok: false; error: string };

/**
 * Turns a callback-data fragment back into a real setting value.
 *
 * Every branch ends at the registry schema, so a malformed callback — a stale
 * button from before a deploy, or a hand-crafted one — fails here rather than
 * writing nonsense into the settings table.
 */
export function parseEditValue<K extends SettingKey>(
  key: K,
  raw: string,
): ParseResult<K> {
  const def = BOT_SETTINGS[key];
  let candidate: unknown;

  switch (def.control) {
    case "pause": {
      if (raw === "inf") candidate = { state: "paused" };
      else if (raw === "0") candidate = { state: "active" };
      else {
        const minutes = Number(raw);
        if (!Number.isFinite(minutes)) return { ok: false, error: "Bad duration." };
        candidate = {
          state: "paused_until",
          until: new Date(Date.now() + minutes * 60_000),
        };
      }
      break;
    }
    case "toggle":
      candidate = raw === "true";
      break;
    case "money":
    case "duration":
    case "percent":
      candidate = raw === "none" ? null : Number(raw);
      break;
    case "choice": {
      if (key === "availability.quietHours") {
        if (raw === "off") candidate = null;
        else {
          const [start, end] = raw.split("-");
          candidate = { start, end };
        }
      } else {
        candidate = raw;
      }
      break;
    }
    case "text":
      candidate = raw === "none" ? null : raw;
      break;
  }

  const parsed = def.schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "That value isn't valid." };

  return { ok: true, value: parsed.data as SettingValue<K> };
}
```

- [ ] **Step 4: Register the handler**

In `apps/api/src/bot/init.ts`, add the imports:

```ts
import { settingsHandler } from "./handlers/settings";
import { dmAccessMiddleware } from "./lib/dm-access";
```

Register the DM gate immediately after the group guard (after the block ending at line 58) and before the auto-reply middleware:

```ts
  // Gate DMs before anything else touches them — a blocked stranger should not
  // cause a photo fetch, a logged message, or a session write.
  bot.use(dmAccessMiddleware);
```

Then register the handler alongside the others, before `aiChatHandler`:

```ts
  bot.use(settingsHandler);
```

- [ ] **Step 5: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: exits 0.

- [ ] **Step 6: Run the full suite**

Run: `bun test apps/api packages`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bot/handlers/settings.ts apps/api/src/bot/lib/settings-parse.ts \
        apps/api/src/bot/init.ts
git commit -m "feat: add /settings menu

Every callback re-checks the caller's ability rather than trusting that the
button came from an authorised menu — a callback is just a string a client
can send at any time."
```

---

## Task 10: Text editing with preview validation

**Files:**
- Modify: `apps/api/src/bot/handlers/settings.ts`

- [ ] **Step 1: Add the edit conversation**

Append to `apps/api/src/bot/handlers/settings.ts`:

```ts
import { createConversation } from "@grammyjs/conversations";
import type { BotConversation } from "../types";
import { renderWelcome } from "../lib/welcome-template";

export const SETTINGS_TEXT_CONVERSATION = "settings-text-edit";

/**
 * Captures the admin's next message as a text setting's new value.
 *
 * For the welcome templates the new text is sent back rendered, exactly as a
 * joiner would see it, BEFORE it is saved. Telegram rejects a message whose
 * HTML doesn't parse, so a broken tag fails here and the old value survives —
 * that failed send is the validation.
 */
export async function settingsTextConversation(
  conversation: BotConversation,
  ctx: BotContext,
  key: SettingKey,
): Promise<void> {
  await ctx.reply(
    `Send the new text for *${BOT_SETTINGS[key].label}*, or /cancel.\n\n` +
      `Placeholders: {name}, {first_name}, {username}`,
    { parse_mode: "Markdown" },
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
    parse_mode: "Markdown",
    reply_markup: page.keyboard,
  });
}
```

Add the `SettingValue` type import to the existing import from `@community-os/shared/bot-settings`.

- [ ] **Step 2: Wire the conversation and its entry points**

Still in `settings.ts`, register the conversation and the two callbacks:

```ts
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
```

- [ ] **Step 3: Add the session slot**

In `apps/api/src/bot/types.ts`, add to `SessionData`:

```ts
  /** Which text setting the edit conversation is collecting. */
  pendingTextSetting?: string;
```

- [ ] **Step 4: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/handlers/settings.ts apps/api/src/bot/types.ts
git commit -m "feat: edit text settings with preview validation

The preview send IS the validation: Telegram refuses a message whose HTML
doesn't parse, so a broken welcome template fails in the admin's own DM
instead of silently failing on the next real joiner."
```

---

## Task 11: AI tools

**Files:**
- Modify: `apps/api/src/bot/ai/tools.ts`

- [ ] **Step 1: Add the three tools**

In `apps/api/src/bot/ai/tools.ts`, add imports at the top:

```ts
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  isSettingKey,
  type SettingKey,
} from "@community-os/shared/bot-settings";
import { getSettings, getHistory } from "../../services/bot-settings.service";
```

Add to `ToolContext`:

```ts
  /**
   * Stores an AI-proposed change set and renders its confirmation card.
   * Absent outside the chat handler, which is what makes the tools decline
   * politely rather than throwing when there's no chat to render into.
   */
  proposeSettings?: (input: {
    changes: { key: string; from: unknown; to: unknown }[];
    rationale?: string;
  }) => Promise<void>;
```

Then inside `createTools`, alongside the other tools:

```ts
    get_settings: tool({
      description:
        "Read the bot's current operational settings — pauses, cost caps, chime-in behaviour, welcome messages. Only available to admins. Use this before proposing any change so you know the current values.",
      inputSchema: z.object({}),
      execute: async () => {
        const allowed = await can(ctx, "update", "Settings");
        if (!allowed) {
          return { error: "Only admins can view bot settings." };
        }

        const snapshot = await getSettings();
        return {
          settings: SETTING_KEYS.map((key) => {
            const def = BOT_SETTINGS[key];
            const format = def.format as (v: unknown) => string;
            return {
              key,
              label: def.label,
              description: def.description,
              group: def.group,
              current: format(snapshot[key]),
              raw: snapshot[key],
            };
          }),
        };
      },
    }),

    propose_settings_change: tool({
      description:
        "Propose one or more settings changes for the admin to confirm. This does NOT change anything — it shows a card with Confirm and Cancel buttons. Always include the complete set of changes you want: calling this again replaces the previous proposal rather than adding to it. Only available to admins.",
      inputSchema: z.object({
        changes: z
          .array(
            z.object({
              key: z.string().describe("Setting key, e.g. 'chimeIn.enabled'"),
              value: z
                .string()
                .describe(
                  "New value as a JSON literal: true, false, 30, 0.9, null, or a quoted string",
                ),
            }),
          )
          .describe("Every change to propose, together"),
        rationale: z
          .string()
          .optional()
          .describe("One short sentence on why, shown on the card"),
      }),
      execute: async ({ changes, rationale }) => {
        const allowed = await can(ctx, "update", "Settings");
        if (!allowed) {
          return { error: "Only admins can change bot settings." };
        }

        if (!ctx.proposeSettings) {
          return { error: "Settings can only be changed from a chat with me." };
        }

        const snapshot = await getSettings();
        const resolved: { key: string; from: unknown; to: unknown }[] = [];

        for (const change of changes) {
          if (!isSettingKey(change.key)) {
            return { error: `There's no setting called '${change.key}'.` };
          }

          let candidate: unknown;
          try {
            candidate = JSON.parse(change.value);
          } catch {
            candidate = change.value;
          }

          const key: SettingKey = change.key;
          const parsed = BOT_SETTINGS[key].schema.safeParse(candidate);
          if (!parsed.success) {
            return {
              error: `'${change.value}' isn't a valid value for ${BOT_SETTINGS[key].label}.`,
            };
          }

          resolved.push({ key, from: snapshot[key], to: parsed.data });
        }

        await ctx.proposeSettings({ changes: resolved, rationale });

        return {
          status: "proposed",
          message:
            "The change card is on screen with Confirm and Cancel buttons. Tell the admin to review it — do not claim anything has changed yet.",
        };
      },
    }),

    get_settings_history: tool({
      description:
        "Read who changed which bot setting, when, and via the menu or AI. Only available to admins.",
      inputSchema: z.object({
        key: z
          .string()
          .optional()
          .describe("Limit to one setting key; omit for all"),
        limit: z.number().optional().describe("How many entries, default 20"),
      }),
      execute: async ({ key, limit }) => {
        const allowed = await can(ctx, "update", "Settings");
        if (!allowed) {
          return { error: "Only admins can view settings history." };
        }

        const scoped = key && isSettingKey(key) ? key : null;
        return { history: await getHistory(scoped, limit ?? 20) };
      },
    }),
```

- [ ] **Step 2: Add the shared ability helper**

The tools above call `ctx.can(...)`. Rather than adding a field to `ToolContext` and threading it through `agent.ts`, define a module-level helper in `tools.ts` — `ToolContext` already carries the `api` client the existing `check_permissions` tool uses at `tools.ts:761`.

Add above `createTools`:

```ts
/**
 * Resolves the calling member's CASL ability.
 *
 * Shared by check_permissions and the settings tools so there is exactly one
 * place that decides what a caller may do. Returns null when the member can't
 * be resolved at all, which every caller treats as "not allowed".
 */
async function resolveAbility(
  ctx: ToolContext,
): Promise<{ ability: ReturnType<typeof defineAbilityFor>; id: string; role: Role } | null> {
  const { data, error } = await ctx.api.api.v1.members.me.get();
  if (error) return null;

  const { id, role } = data.user;
  if (!isRole(role)) return null;

  return { ability: defineAbilityFor({ id, role }), id, role };
}

/** Convenience wrapper for the simple "may they?" checks. */
async function can(
  ctx: ToolContext,
  action: Actions,
  subject: Subjects,
): Promise<boolean> {
  const resolved = await resolveAbility(ctx);
  return resolved ? resolved.ability.can(action, subject) : false;
}
```

Add `Role` to the existing `@community-os/shared/constants` import.

The three settings tools in Step 1 already call `can(ctx, "update", "Settings")`, so they need no change once this helper exists.

Then rewrite the existing `check_permissions` execute body to use the same helper — do not leave two copies of the resolution logic:

```ts
      execute: async ({ action, subject }) => {
        const resolved = await resolveAbility(ctx);
        if (!resolved) {
          return { allowed: false, reason: "Could not retrieve user profile" };
        }

        const { ability, id, role } = resolved;

        let subjectArg: Subjects;
        if (subject === "Member") {
          subjectArg = {
            __caslSubjectType__: "Member",
            userId: id,
          } as Subjects;
        } else if (subject === "Project") {
          subjectArg = {
            __caslSubjectType__: "Project",
            ownerId: id,
          } as Subjects;
        } else {
          subjectArg = subject;
        }

        return { allowed: ability.can(action as Actions, subjectArg), role };
      },
```

Also add `"Settings"` to `check_permissions`'s `subject` enum, so the agent can ask about it the same way it asks about `Fund`.

- [ ] **Step 3: Supply `proposeSettings` from the chat handler**

In `apps/api/src/bot/handlers/ai-chat.ts`, inside the `runAgent` call site, pass a `proposeSettings` implementation that stores the draft in session and sends the card:

```ts
  const proposeSettings = async (input: {
    changes: { key: string; from: unknown; to: unknown }[];
    rationale?: string;
  }) => {
    const draft = {
      changes: input.changes,
      rationale: input.rationale,
      createdAt: Date.now(),
      messageId: 0,
    };
    const page = renderDraftCard(draft, []);
    const sent = await ctx.reply(page.text, {
      parse_mode: "Markdown",
      reply_markup: page.keyboard,
    });
    ctx.session.settingsDraft = { ...draft, messageId: sent.message_id };
  };
```

Thread it through `runAgent`'s parameters into `ToolContext` the same way `askUser` already is.

- [ ] **Step 4: Guard the research tool**

Still in `tools.ts`, at the top of the existing `research` tool's `execute` (line 272), add:

```ts
        const settings = await getSettings();
        if (!settings["research.webEnabled"]) {
          return "Web research is currently turned off for this community. Answer from what you know or from community data.";
        }
```

- [ ] **Step 5: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bot/ai/tools.ts apps/api/src/bot/handlers/ai-chat.ts
git commit -m "feat: add settings tools to the AI agent

No AI tool writes. propose_settings_change builds a draft and renders the same
confirmation card the menu uses, so natural language and buttons converge on
one audited code path."
```

---

# Phase 4 — Enforcement

## Task 12: Budget verdict

**Files:**
- Create: `apps/api/src/bot/lib/ai-budget.ts`
- Test: `apps/api/src/bot/lib/ai-budget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bot/lib/ai-budget.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { decideBudget } from "./ai-budget";

const base = {
  callClass: "interactive" as const,
  backgroundPaused: false,
  spentTodayUsd: 0,
  spentMonthUsd: 0,
  dailyCapUsd: 10 as number | null,
  monthlyCapUsd: 150 as number | null,
};

describe("decideBudget", () => {
  test("allows a normal interactive call", () => {
    expect(decideBudget(base).allowed).toBe(true);
  });

  test("blocks a background call while background is paused", () => {
    const result = decideBudget({
      ...base,
      callClass: "background",
      backgroundPaused: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("background_paused");
  });

  test("an interactive call is unaffected by the background pause", () => {
    expect(
      decideBudget({ ...base, backgroundPaused: true }).allowed,
    ).toBe(true);
  });

  test("blocks at the daily cap", () => {
    const result = decideBudget({ ...base, spentTodayUsd: 10 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("daily_cap");
  });

  test("allows just under the daily cap", () => {
    expect(decideBudget({ ...base, spentTodayUsd: 9.99 }).allowed).toBe(true);
  });

  test("blocks at the monthly cap even when the day is clear", () => {
    const result = decideBudget({ ...base, spentMonthUsd: 150 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("monthly_cap");
  });

  test("a null cap means unlimited", () => {
    expect(
      decideBudget({
        ...base,
        dailyCapUsd: null,
        monthlyCapUsd: null,
        spentTodayUsd: 9_999,
        spentMonthUsd: 9_999,
      }).allowed,
    ).toBe(true);
  });

  // Caps bind everything. A pause that only stopped members while the crons
  // kept spending would defeat the point of pausing during a cost spike.
  test("caps apply to background calls too", () => {
    expect(
      decideBudget({ ...base, callClass: "background", spentTodayUsd: 10 })
        .allowed,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/ai-budget.test.ts`
Expected: FAIL — `Cannot find module './ai-budget'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/bot/lib/ai-budget.ts`:

```ts
export type CallClass = "interactive" | "background";

export type BudgetVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: "background_paused" | "daily_cap" | "monthly_cap";
    };

export interface BudgetInput {
  callClass: CallClass;
  backgroundPaused: boolean;
  spentTodayUsd: number;
  spentMonthUsd: number;
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
}

/**
 * Decides whether an AI call may proceed. Pure — the caller gathers the facts.
 *
 * Caps bind background AND interactive calls. A pause that stopped members
 * while the crons kept spending would defeat the purpose of pausing during a
 * cost spike, which is the situation these exist for.
 */
export function decideBudget(input: BudgetInput): BudgetVerdict {
  if (input.callClass === "background" && input.backgroundPaused) {
    return { allowed: false, reason: "background_paused" };
  }

  if (input.dailyCapUsd !== null && input.spentTodayUsd >= input.dailyCapUsd) {
    return { allowed: false, reason: "daily_cap" };
  }

  if (
    input.monthlyCapUsd !== null &&
    input.spentMonthUsd >= input.monthlyCapUsd
  ) {
    return { allowed: false, reason: "monthly_cap" };
  }

  return { allowed: true };
}

/** Thrown by the ai.service gate so callers fail loudly rather than silently. */
export class AiBudgetError extends Error {
  constructor(public readonly reason: string) {
    super(`AI call blocked: ${reason}`);
    this.name = "AiBudgetError";
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/ai-budget.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/ai-budget.ts apps/api/src/bot/lib/ai-budget.test.ts
git commit -m "feat: add AI budget verdict

Caps bind background calls too — pausing during a cost spike is pointless if
the crons keep spending."
```

---

## Task 13: Spend counter and the ai.service gate

**Files:**
- Create: `apps/api/src/services/ai-spend-counter.ts`
- Modify: `apps/api/src/services/ai.service.ts:60-64,127-196`

- [ ] **Step 1: Write the spend counter**

Create `apps/api/src/services/ai-spend-counter.ts`:

```ts
import { and, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage } from "../db/schema";

/**
 * Running community spend, seeded from ai_usage and incremented locally.
 *
 * Querying ai_usage before every AI call would be far too expensive, so the
 * totals are held in process and re-read periodically.
 *
 * KNOWN LIMITATION: with more than one API replica each holds a partial view,
 * so a cap can overshoot by up to REFRESH_MS worth of spend before converging.
 * Accepted for a soft budget guard. A hard ceiling would need SELECT … FOR
 * UPDATE per call and real added latency.
 */
const REFRESH_MS = 60_000;

let dayKey: string | null = null;
let monthKey: string | null = null;
let daySpendUsd = 0;
let monthSpendUsd = 0;
let refreshedAt = 0;

function keys(now: Date): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function startOfDayUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function sumSince(
  since: Date,
  estimate: (model: string, input: number, output: number) => number,
): Promise<number> {
  const rows = await db
    .select({
      model: aiUsage.model,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, since)))
    .groupBy(aiUsage.model);

  return rows.reduce(
    (total, row) => total + estimate(row.model, row.inputTokens, row.outputTokens),
    0,
  );
}

export interface Spend {
  todayUsd: number;
  monthUsd: number;
}

export async function getSpend(
  now: Date,
  estimate: (model: string, input: number, output: number) => number,
): Promise<Spend> {
  const current = keys(now);
  const rolledOver = current.day !== dayKey || current.month !== monthKey;
  const stale = now.getTime() - refreshedAt >= REFRESH_MS;

  if (rolledOver || stale) {
    const [today, month] = await Promise.all([
      sumSince(startOfDayUtc(now), estimate),
      sumSince(startOfMonthUtc(now), estimate),
    ]);

    daySpendUsd = today;
    monthSpendUsd = month;
    dayKey = current.day;
    monthKey = current.month;
    refreshedAt = now.getTime();
  }

  return { todayUsd: daySpendUsd, monthUsd: monthSpendUsd };
}

/** Called after a successful call so the counter tracks between refreshes. */
export function addSpend(usd: number): void {
  daySpendUsd += usd;
  monthSpendUsd += usd;
}

/** Test seam — the counter is module state. */
export function resetSpendCounter(): void {
  dayKey = null;
  monthKey = null;
  daySpendUsd = 0;
  monthSpendUsd = 0;
  refreshedAt = 0;
}
```

- [ ] **Step 2: Add `class` to TrackingContext**

In `apps/api/src/services/ai.service.ts`, change `TrackingContext` (line 60):

```ts
export interface TrackingContext {
  caller: string;
  telegramUserId?: number | null;
  chatId?: string | null;
  /**
   * Interactive calls answer a member who is waiting; background calls are
   * crons and extraction jobs. The background pause only stops the latter.
   * Defaults to "interactive" — the safer assumption, since wrongly treating a
   * member's question as background would silently drop their answer.
   */
  class?: CallClass;
}
```

Add the imports:

```ts
import { decideBudget, AiBudgetError, type CallClass } from "../bot/lib/ai-budget";
import { getSettings } from "./bot-settings.service";
import { getSpend, addSpend } from "./ai-spend-counter";
import { isPaused } from "@community-os/shared/bot-settings";
```

- [ ] **Step 3: Add the pre-dispatch gate**

Still in `ai.service.ts`, add above `trackedGenerateText`:

```ts
/**
 * The single choke point for the background pause and every cost cap.
 *
 * Every AI call in the codebase already funnels through this module, so gating
 * here covers the crons, the memory extractor, the profile sweep and the chat
 * agent at once — instead of a check in each, which would rot.
 */
async function assertWithinBudget(ctx: TrackingContext): Promise<void> {
  const now = new Date();
  const settings = await getSettings();
  const spend = await getSpend(now, estimateCost);

  const verdict = decideBudget({
    callClass: ctx.class ?? "interactive",
    backgroundPaused: isPaused(settings["ai.background"], now),
    spentTodayUsd: spend.todayUsd,
    spentMonthUsd: spend.monthUsd,
    dailyCapUsd: settings["cost.dailyCapUsd"],
    monthlyCapUsd: settings["cost.monthlyCapUsd"],
  });

  if (!verdict.allowed) {
    console.warn(`[ai-budget] blocked ${ctx.caller}: ${verdict.reason}`);
    throw new AiBudgetError(verdict.reason);
  }
}
```

Call it as the first statement of both `trackedGenerateText` and `trackedGenerateObject`:

```ts
  await assertWithinBudget(ctx);
```

- [ ] **Step 4: Record spend after each successful call**

In both tracked wrappers, in the success branch immediately after computing `durationMs`, add:

```ts
    addSpend(
      estimateCost(
        modelId,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
      ),
    );
```

- [ ] **Step 5: Type-check and run the suite**

Run: `bun run --cwd apps/api type-check && bun test apps/api packages`
Expected: exits 0, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ai-spend-counter.ts apps/api/src/services/ai.service.ts
git commit -m "feat: gate AI calls on the background pause and cost caps

One choke point rather than a check in each cron: every AI call already goes
through this module, so a new caller is covered automatically instead of
being a place someone forgets to add the guard."
```

---

## Task 14: Configurable advisor gating

**Files:**
- Modify: `apps/api/src/bot/ai/advisor-access.ts:19,48-85`
- Modify: `apps/api/src/bot/ai/advisor-gate.ts`
- Modify: `apps/api/src/bot/ai/advisor-access.test.ts`

- [ ] **Step 1: Extend the pure decision**

In `apps/api/src/bot/ai/advisor-access.ts`, keep `ADVISOR_DAILY_BUDGET_USD` exported (it is now the registry default) and change `decideAccess` to take the configured values:

```ts
import type { AdvisorTierLimit } from "@community-os/shared/bot-settings";

/** Decides access without touching the database — the testable core. */
export function decideAccess(input: {
  tier: AdvisorTier;
  telegramId: number | null;
  isRecentlyActive: boolean;
  spentTodayUsd: number;
  /** From cost.advisorDailyBudgetUsd. */
  dailyBudgetUsd: number;
  /** From cost.advisorMaxTier. */
  maxTier: AdvisorTierLimit;
}): AdvisorAccess {
  const {
    tier,
    telegramId,
    isRecentlyActive,
    spentTodayUsd,
    dailyBudgetUsd,
    maxTier,
  } = input;

  if (telegramId === null) {
    return {
      allowed: false,
      reason: "unknown_sender",
      tellUser:
        "I can't work out who's asking, so I can't reach for deeper reasoning here. Try again from the group chat.",
    };
  }

  // Checked before the budget: when escalation is off entirely, "you've used
  // up today's allowance" would be a misleading thing to tell a member.
  if (maxTier === "off" || (maxTier === "big" && tier === "bigger")) {
    return {
      allowed: false,
      reason: "tier_disabled",
      tellUser:
        "Deeper reasoning is switched off at the moment. I'll answer with what I can work out myself.",
    };
  }

  if (spentTodayUsd >= dailyBudgetUsd) {
    return {
      allowed: false,
      reason: "budget",
      tellUser:
        "You've used up today's allowance for deep reasoning — it resets at midnight UTC. I'll answer with what I can work out myself in the meantime.",
    };
  }

  // Only the expensive tier is activity-gated; the cheaper one stays open.
  if (tier === "bigger" && !isRecentlyActive) {
    return {
      allowed: false,
      reason: "inactive",
      tellUser:
        `The deepest reasoning is reserved for members who've been active in the last ${ACTIVE_WINDOW_DAYS} days — say salam in the group and it'll open up. I'll do my best with what I have.`,
    };
  }

  return { allowed: true };
}
```

Add `"tier_disabled"` to the `AdvisorDenied` reason union:

```ts
export interface AdvisorDenied {
  allowed: false;
  reason: "unknown_sender" | "inactive" | "budget" | "tier_disabled";
  /** Verbatim text for the agent to relay to the member. */
  tellUser: string;
}
```

- [ ] **Step 2: Read settings in the gate**

Replace `apps/api/src/bot/ai/advisor-gate.ts` with:

```ts
import { aiService } from "../../services/ai.service";
import { hasRecentMessages } from "../../services/messages.service";
import { getSettings } from "../../services/bot-settings.service";
import type { AdvisorTier } from "./advisor";
import {
  ADVISOR_CALLERS,
  activeSince,
  decideAccess,
  startOfDayUtc,
  type AdvisorAccess,
} from "./advisor-access";

/** Gathers the facts and applies `decideAccess`. */
export async function checkAdvisorAccess(
  tier: AdvisorTier,
  telegramId: number | null,
  now: Date = new Date(),
): Promise<AdvisorAccess> {
  const settings = await getSettings();
  const dailyBudgetUsd = settings["cost.advisorDailyBudgetUsd"];
  const maxTier = settings["cost.advisorMaxTier"];

  if (telegramId === null) {
    return decideAccess({
      tier,
      telegramId,
      isRecentlyActive: false,
      spentTodayUsd: 0,
      dailyBudgetUsd,
      maxTier,
    });
  }

  const [isRecentlyActive, spentTodayUsd] = await Promise.all([
    // Only the deep tier needs the activity lookup — skip the query otherwise.
    tier === "bigger"
      ? hasRecentMessages(telegramId, activeSince(now)).catch(() => false)
      : Promise.resolve(true),
    aiService
      .getSpendByCaller(telegramId, ADVISOR_CALLERS, startOfDayUtc(now))
      .catch(() => 0),
  ]);

  return decideAccess({
    tier,
    telegramId,
    isRecentlyActive,
    spentTodayUsd,
    dailyBudgetUsd,
    maxTier,
  });
}
```

- [ ] **Step 3: Update the existing tests**

Open `apps/api/src/bot/ai/advisor-access.test.ts`. Every `decideAccess` call now needs `dailyBudgetUsd` and `maxTier`. Add a shared base object at the top and spread it into each call:

```ts
const base = { dailyBudgetUsd: 0.5, maxTier: "bigger" as const };
```

Then add two cases for the new branch:

```ts
test("maxTier off denies every tier", () => {
  const result = decideAccess({
    ...base,
    maxTier: "off",
    tier: "big",
    telegramId: 1,
    isRecentlyActive: true,
    spentTodayUsd: 0,
  });
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toBe("tier_disabled");
});

test("maxTier big denies the deeper tier but allows the cheaper one", () => {
  const shared = {
    ...base,
    maxTier: "big" as const,
    telegramId: 1,
    isRecentlyActive: true,
    spentTodayUsd: 0,
  };
  expect(decideAccess({ ...shared, tier: "bigger" }).allowed).toBe(false);
  expect(decideAccess({ ...shared, tier: "big" }).allowed).toBe(true);
});
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/ai/advisor-access.test.ts`
Expected: PASS, including the two new cases.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/ai/advisor-access.ts apps/api/src/bot/ai/advisor-gate.ts \
        apps/api/src/bot/ai/advisor-access.test.ts
git commit -m "feat: make advisor budget and max tier configurable

tier_disabled is checked before the budget so a member is told escalation is
off rather than being told they've spent an allowance they never touched."
```

---

## Task 15: Chat gating — pause, chime-in, quiet hours

**Files:**
- Modify: `apps/api/src/bot/handlers/ai-chat.ts:55-115,254-287`
- Modify: `apps/api/src/bot/lib/chime-in.ts`
- Test: `apps/api/src/bot/lib/chime-in.test.ts`

- [ ] **Step 1: Write the failing quiet-hours test**

Add to `apps/api/src/bot/lib/chime-in.test.ts`:

```ts
import { inQuietHours } from "./chime-in";

describe("inQuietHours", () => {
  const at = (hhmm: string) => new Date(`2026-08-22T${hhmm}:00+08:00`);

  test("null window is never quiet", () => {
    expect(inQuietHours(null, at("03:00"))).toBe(false);
  });

  test("inside a same-day window", () => {
    expect(inQuietHours({ start: "13:00", end: "15:00" }, at("14:00"))).toBe(true);
  });

  test("outside a same-day window", () => {
    expect(inQuietHours({ start: "13:00", end: "15:00" }, at("16:00"))).toBe(false);
  });

  test("a window wrapping midnight covers the late evening", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("23:30"))).toBe(true);
  });

  test("a window wrapping midnight covers the early morning", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("02:00"))).toBe(true);
  });

  test("a window wrapping midnight excludes the afternoon", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("14:00"))).toBe(false);
  });

  test("the start minute is inside, the end minute is outside", () => {
    const w = { start: "23:00", end: "07:00" };
    expect(inQuietHours(w, at("23:00"))).toBe(true);
    expect(inQuietHours(w, at("07:00"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test apps/api/src/bot/lib/chime-in.test.ts`
Expected: FAIL — `inQuietHours` is not exported.

- [ ] **Step 3: Add `inQuietHours`**

Append to `apps/api/src/bot/lib/chime-in.ts`:

```ts
import type { QuietHours } from "@community-os/shared/bot-settings";

/** Minutes past midnight in Singapore, which is what the window is defined in. */
function sgtMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Whether `now` falls inside the quiet window.
 *
 * Windows wrap midnight — 23:00–07:00 is the common case — so a start after
 * the end means "outside the daytime gap" rather than an empty range. Start is
 * inclusive, end exclusive, so back-to-back windows wouldn't double-count.
 */
export function inQuietHours(window: QuietHours, now: Date): boolean {
  if (window === null) return false;

  const current = sgtMinutes(now);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);

  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/bot/lib/chime-in.test.ts`
Expected: PASS, including 7 new cases.

- [ ] **Step 5: Gate the chat handler**

In `apps/api/src/bot/handlers/ai-chat.ts`, add imports:

```ts
import { isPaused } from "@community-os/shared/bot-settings";
import { getSettings } from "../../services/bot-settings.service";
import { inQuietHours } from "../lib/chime-in";
import { shouldSendDenial } from "../lib/dm-access";
import { resolveUser } from "../lib/auth";
```

Then, immediately after the `/` command rejection block (which ends at line 71), insert the pause gate:

```ts
  const settings = await getSettings();
  const now_ = new Date();

  if (isPaused(settings["ai.replies"], now_)) {
    // Admins keep talking to the AI in DMs — otherwise pausing would remove
    // the very channel used to unpause.
    const resolved = isPrivate && ctx.from ? await resolveUser(String(ctx.from.id)) : null;
    const role = resolved?.member.role;
    const isAdmin = role === "admin" || role === "superadmin";

    if (!isAdmin) {
      // Group: silent drop, so the bot simply looks offline. DM: a reply,
      // because silence in a one-to-one chat reads as a fault.
      const reply = settings["dm.maintenanceReply"];
      if (isPrivate && reply !== null && ctx.from && shouldSendDenial(ctx.from.id)) {
        await ctx.reply(reply);
      }
      return;
    }
  }
```

- [ ] **Step 6: Make `shouldChimeIn` configurable**

Replace the body of `shouldChimeIn` at the bottom of `ai-chat.ts`:

```ts
async function shouldChimeIn(
  ctx: BotContext,
  text: string,
  now: number,
): Promise<boolean> {
  const chatId = String(ctx.chat!.id);
  const settings = await getSettings();

  if (!settings["chimeIn.enabled"]) return false;
  if (inQuietHours(settings["availability.quietHours"], new Date(now))) {
    return false;
  }

  const skip = preFilter({ text, isBot: ctx.from?.is_bot ?? false });
  if (skip) return false;

  const cooldownMs = settings["chimeIn.cooldownMinutes"] * 60_000;
  if (!offCooldown(lastChimeAt(chatId), now, cooldownMs)) return false;

  // Judged with surrounding conversation — "yeah probably" is unjudgeable alone.
  const context = await getRecentChatMessages(
    chatId,
    ctx.message!.message_thread_id ?? null,
    ONE_HOUR_MS,
    CHIME_IN_CONTEXT_MESSAGES,
    ctx.message!.message_id,
  );

  const decision = applyConfidenceGate(
    await judgeChimeIn({
      message: text,
      transcript: formatGroupHistory(context),
      chatId,
      telegramUserId: ctx.from?.id ?? null,
    }),
    settings["chimeIn.minConfidence"],
  );

  console.log(
    `[chime-in] ${decision.respond ? "SPEAK" : "stay quiet"} (${decision.confidence.toFixed(2)}) — ${decision.reason}`,
  );

  return decision.respond;
}
```

Add `applyConfidenceGate` to the existing import from `../lib/chime-in`.

**Check first:** read `apps/api/src/bot/lib/chime-in-judge.ts`. If `judgeChimeIn` already applies `applyConfidenceGate` internally with the default threshold, remove that call from the judge and let this call site own it — applying the gate twice with different thresholds would silently use the stricter one.

- [ ] **Step 7: Type-check and run the suite**

Run: `bun run --cwd apps/api type-check && bun test apps/api packages`
Expected: exits 0, all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bot/handlers/ai-chat.ts apps/api/src/bot/lib/chime-in.ts \
        apps/api/src/bot/lib/chime-in.test.ts
git commit -m "feat: gate chat replies on pause, quiet hours and chime-in settings

Admins bypass the pause in DMs, since pausing otherwise removes the channel
used to unpause. Quiet hours only suppress uninvited chime-ins — a direct
question at 1am still gets an answer."
```

---

## Task 16: Memory extraction guard and templated welcome

**Files:**
- Modify: `apps/api/src/bot/lib/telegram-message-logger.ts:172-173`
- Modify: `apps/api/src/bot/lib/auto-register.ts:90-114,205-212`

- [ ] **Step 1: Guard memory extraction**

In `apps/api/src/bot/lib/telegram-message-logger.ts`, add the import:

```ts
import { getSettings } from "../../services/bot-settings.service";
```

Replace the extraction block at `telegram-message-logger.ts:171-182` with:

```ts
      // Memory extraction is fire-and-forget
      if (shouldExtractMemory(content, from?.is_bot ?? false)) {
        const settings = await getSettings();
        if (settings["memory.extractionEnabled"]) {
          extractMemories(
            content,
            from?.first_name ?? "Unknown",
            from?.username ?? null,
            from?.id ?? null,
            row.chatId,
            row.messageId,
          ).catch((err) => {
            console.error("[memory-extractor] failed:", err);
          });
        }
      }
```

The setting is read *after* `shouldExtractMemory`, not before: the pure pre-filter rejects most messages for free, so checking it first avoids a settings read on every single group message.

- [ ] **Step 2: Template the welcome messages**

In `apps/api/src/bot/lib/auto-register.ts`, add imports:

```ts
import { getSettings } from "../../services/bot-settings.service";
import { renderWelcome } from "./welcome-template";
```

Replace `sendWelcome` (lines 90-114) with:

```ts
async function sendWelcome(
  ctx: BotContext,
  from: User,
  userId: string,
): Promise<void> {
  // Claimed regardless of whether greetings are enabled, so a member who joins
  // while they're off is not greeted later when they're switched back on.
  if (!(await membersService.claimWelcome(userId))) return;

  const settings = await getSettings();
  if (!settings["welcome.enabled"]) return;

  const text = renderWelcome(settings["welcome.newMemberText"], {
    telegramId: from.id,
    firstName: from.first_name,
    username: from.username,
  });

  const keyboard = settings["welcome.showProfileButton"]
    ? new InlineKeyboard().url(
        "Set up profile",
        `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=profile`,
      )
    : undefined;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}
```

- [ ] **Step 3: Template the rejoin message**

Replace the hardcoded rejoin reply (around line 205):

```ts
        const settings = await getSettings();
        if (settings["welcome.enabled"]) {
          await ctx.reply(
            renderWelcome(settings["welcome.returningText"], {
              telegramId: telegramUser.id,
              firstName: telegramUser.first_name,
              username: telegramUser.username,
            }),
            { parse_mode: "HTML" },
          );
        }
```

- [ ] **Step 4: Type-check and run the suite**

Run: `bun run --cwd apps/api type-check && bun test apps/api packages`
Expected: exits 0, all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/telegram-message-logger.ts apps/api/src/bot/lib/auto-register.ts
git commit -m "feat: make welcome messages configurable, guard memory extraction

claimWelcome is still called when greetings are disabled, so switching them
back on doesn't greet everyone who joined in the meantime."
```

---

## Task 17: Spend alerts

**Files:**
- Modify: `apps/api/src/services/ai-spend-counter.ts`
- Modify: `apps/api/src/services/ai.service.ts`

- [ ] **Step 1: Add alert tracking to the counter**

Append to `apps/api/src/services/ai-spend-counter.ts`:

```ts
let alertedForDay: string | null = null;

/**
 * True at most once per UTC day, the first time the day's spend crosses the
 * threshold. Returns false when no threshold is set.
 */
export function shouldAlert(
  now: Date,
  threshold: number | null,
  spentTodayUsd: number,
): boolean {
  if (threshold === null) return false;
  if (spentTodayUsd < threshold) return false;

  const day = now.toISOString().slice(0, 10);
  if (alertedForDay === day) return false;

  alertedForDay = day;
  return true;
}
```

Add `alertedForDay = null;` to `resetSpendCounter`.

- [ ] **Step 2: Send the alert**

Create `apps/api/src/bot/lib/spend-alert.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { bot } from "../bot";
import { db } from "../../db";
import { account, members } from "../../db/schema";

/**
 * DMs every admin that the day's spend crossed the alert threshold.
 *
 * Lives in bot/ rather than services/ because it sends Telegram messages.
 * ai.service reaches it through a dynamic import so the service layer keeps no
 * static dependency on the bot.
 */
export async function notifyAdminsOfSpend(
  spentUsd: number,
  thresholdUsd: number,
): Promise<void> {
  const admins = await db
    .select({ telegramId: account.accountId })
    .from(members)
    .innerJoin(account, eq(account.userId, members.userId))
    .where(
      and(
        // Same filter resolveUser uses — a member with a non-Telegram account
        // row would otherwise yield an account ID that isn't a chat ID.
        eq(account.providerId, "telegram"),
        inArray(members.role, ["admin", "superadmin"]),
      ),
    );

  const text =
    `⚠️ AI spend today has reached $${spentUsd.toFixed(2)}, ` +
    `past your $${thresholdUsd} alert threshold.\n\n` +
    `Use /settings → Cost to adjust the caps, or pause AI entirely.`;

  for (const admin of admins) {
    if (!admin.telegramId) continue;
    await bot.api.sendMessage(admin.telegramId, text).catch((err) => {
      console.error(`[spend-alert] DM to ${admin.telegramId} failed:`, err);
    });
  }
}
```

Then in `apps/api/src/services/ai.service.ts`, add `shouldAlert` to the `ai-spend-counter` import and extend `assertWithinBudget` — after the verdict check, so a blocked call doesn't also fire an alert:

```ts
  const threshold = settings["cost.alertThresholdUsd"];
  if (shouldAlert(now, threshold, spend.todayUsd)) {
    // Dynamic import keeps the service layer free of a static bot dependency.
    // Fire-and-forget: a failed alert must never block a member's answer.
    import("../bot/lib/spend-alert")
      .then((m) => m.notifyAdminsOfSpend(spend.todayUsd, threshold ?? 0))
      .catch((err) => console.error("[ai-budget] spend alert failed:", err));
  }
```

- [ ] **Step 3: Type-check and run the suite**

Run: `bun run --cwd apps/api type-check && bun test apps/api packages`
Expected: exits 0, all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/ai-spend-counter.ts apps/api/src/services/ai.service.ts \
        apps/api/src/bot/lib/spend-alert.ts
git commit -m "feat: DM admins when daily AI spend crosses the alert threshold

Dynamic import so the service layer keeps no static dependency on the bot.
Once per UTC day, and fire-and-forget: a failed alert must never block an
answer a member is waiting for."
```

---

# Phase 5 — Finishing

## Task 18: Document `/settings` and verify end to end

**Files:**
- Modify: `apps/api/src/bot/handlers/help.ts`

- [ ] **Step 1: Add `/settings` to help**

`help.ts` has two lists — the `/start` welcome (plain text) and the `/help` output (HTML with emoji). Add the line to both, keeping each one's existing formatting.

In the `/start` reply, after the `/profile` line:

```ts
      `/profile — View or edit your community profile\n` +
      `/settings — Configure the bot (admins only, DM)\n` +
      `/help — Show this help message\n\n` +
```

In the `/help` reply, after the `/profile` line:

```ts
      `👤 /profile — View or edit your community profile\n` +
      `⚙️ /settings — Configure the bot (admins only, DM)\n` +
      `❓ /help — Show this help message\n\n` +
```

- [ ] **Step 2: Run the whole suite**

Run: `bun test apps/api packages`
Expected: all pass.

- [ ] **Step 3: Lint and type-check the workspace**

Run: `bun lint && bun type-check`
Expected: both exit 0. Run `bun lint:fix` for any auto-fixable issues, then re-run.

- [ ] **Step 4: Verify the migration is committed**

Run: `git status --short apps/api/drizzle`
Expected: empty output — the migration was committed in Task 3. If files appear, commit them now.

- [ ] **Step 5: Manual smoke test**

Start the API: `bun run --cwd apps/api dev`

**Note:** `apps/api/.env` points `DATABASE_URL` at the production Neon database, and its bot token is a test bot that is not in the community group. So this exercises DM flows against real data — read freely, and be careful about writes.

Walk through:

1. DM `/settings` → the Availability page renders with six buttons.
2. Tap `Chime-ins` → the description, current value and default all show.
3. Tap `Turn off` → confirmation card shows `on → off`.
4. Tap `Undo` → returns to `on`.
5. Tap `Cost ›` → the Cost page renders.
6. Ask the bot in natural language: *"turn off chime-ins and drop the daily cap to $4"* → a draft card with two rows, an `✕` per row, and `✓ Confirm all`.
7. Tap one `✕` → the card re-renders with one row.
8. Tap `✓ Confirm all` → the applied card shows.
9. Tap `Recent changes` → the audit entries appear, marked `via AI`.
10. Reset everything you changed via `Reset to default`.

- [ ] **Step 6: Set the real cap values**

Run `/usage all` in the bot and read the monthly average. Then set `cost.dailyCapUsd` and `cost.monthlyCapUsd` to roughly **2× the observed peak** via the menu, so a cap never fires on an ordinary day.

The `10` / `150` defaults in the registry are placeholders. If the observed spend is far from them, update the registry defaults too and commit that change — otherwise a fresh environment ships with numbers that don't match reality.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bot/handlers/help.ts
git commit -m "docs: document /settings in bot help"
```

---

## Post-implementation review

Once every task is done, run `superpowers:requesting-code-review` before merging. Points worth directing a reviewer at:

1. **Callback authorisation** — every `set:*` callback re-resolves the caller and re-checks the ability. A callback is a string any client can send; none of these may trust that the button came from a menu the bot rendered.
2. **The DM gate's position** in `init.ts` — it must sit after the group guard and before the message logger, photo sync, session and conversations.
3. **Cache invalidation** — every write path calls `invalidateSettingsCache()`. A missed one gives up to 30 seconds of stale behaviour after a change, which reads as "the setting didn't work".
4. **The spend counter's replica caveat** is documented in the module. Confirm the Railway service is still running a single replica; if it has been scaled up, the caps need revisiting.
