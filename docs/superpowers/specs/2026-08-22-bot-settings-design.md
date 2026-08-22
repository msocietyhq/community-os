# Configurable Bot Settings

**Date:** 2026-08-22
**Status:** Approved, ready for planning

## Problem

Every operational knob on the Telegram bot is a hardcoded constant compiled into
the deploy. Muting a misbehaving bot, capping a runaway AI spend, quieting the
chime-in, or fixing a typo in the welcome message all require a code change and a
Railway deploy. The people who need those levers — community admins — are not
always the people holding a terminal, and the situations that call for them
(a cost spike, a noisy release) are exactly the situations where a deploy cycle
is too slow.

Today's constants:

| Constant | File | Value |
| --- | --- | --- |
| `ADVISOR_DAILY_BUDGET_USD` | `bot/ai/advisor-access.ts` | `0.5` |
| `CHIME_IN_COOLDOWN_MS` | `bot/lib/chime-in.ts` | 30 min |
| `CHIME_IN_MIN_CONFIDENCE` | `bot/lib/chime-in.ts` | `0.8` |
| Welcome copy | `bot/lib/auto-register.ts` | inline HTML |
| Rejoin copy | `bot/lib/auto-register.ts` | inline HTML |

`ACTIVE_WINDOW_DAYS` (`90`) stays hardcoded. It is a membership policy constant
rather than an operational lever — nothing about a cost spike or a noisy release
is fixed by changing it — so it is deliberately out of scope.

## Goals

Admins can read and change the bot's operational settings from a Telegram DM,
through either a button-driven menu or natural language, with every change
attributed and auditable.

**Non-goals for v1:**

- Scheduled-broadcast settings (enabling, disabling or rescheduling the four
  crons in `digest-scheduler.ts`). Deliberately deferred.
- A web portal surface. The service layer is framework-agnostic so this is a
  later, cheap addition, but no Elysia routes ship in v1.
- Per-chat or per-topic scoping. There is one community group; all settings are
  global, with `dm.access` and the pause states distinguishing DM from group
  where it matters.

## Architecture

Three layers, each with one job:

1. **Registry** (`packages/shared`) — a declarative description of every setting.
   The single source of truth for validation, defaults, labels, descriptions,
   grouping, and how the menu renders each control.
2. **Service** (`apps/api/src/services`) — reads and writes settings, merges
   defaults, caches, and writes the audit trail. Framework-agnostic.
3. **Front-ends** (`apps/api/src/bot`) — the button menu and the AI tools. Both
   derive entirely from the registry and both write through the service. Adding
   a knob means adding one registry entry; neither front-end needs touching.

### Registry

`packages/shared/src/bot-settings.ts`:

```ts
interface SettingDef<T> {
  schema: z.ZodType<T>;
  default: T;
  label: string;
  /** One or two sentences. Shown on the setting's page and given to the AI. */
  description: string;
  group: 'availability' | 'cost' | 'behaviour' | 'welcome';
  control: 'pause' | 'toggle' | 'money' | 'duration' | 'percent' | 'choice' | 'text';
  /** Human-readable current value: "$0.50/day", "paused until 16:42 SGT". */
  format: (v: T) => string;
  /** Minimum role that may change this. Defaults to 'admin'. */
  minRole?: Role;
}
```

The snapshot type is derived, never hand-written:

```ts
type SettingsSnapshot = {
  [K in keyof typeof BOT_SETTINGS]: z.infer<typeof BOT_SETTINGS[K]['schema']>
};
```

### Storage

```ts
export const botSettings = pgTable("bot_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Rows exist **only for overridden settings**. Anything absent falls back to the
registry default. Three consequences, all deliberate:

- "Reset to default" is a `DELETE`, not a write of the current default value.
- Shipping a new default in code takes effect immediately for anyone who hasn't
  overridden that key — no data migration.
- The table ships empty, so the deploy changes no behaviour at all.

### Caching

`getSettings(): Promise<SettingsSnapshot>` is backed by a module-level cache with
a 30-second TTL, invalidated synchronously on local write. Because the bot runs
in-process and settings are changed from within that process, a change you make
in DM applies to the very next message. The TTL exists to cover a second Railway
replica or a future web-portal writer.

## Settings

Twenty keys across four groups.

### availability

| Key | Type | Default |
| --- | --- | --- |
| `ai.replies` | `active \| paused \| paused_until{date}` | `active` |
| `ai.background` | `active \| paused \| paused_until{date}` | `active` |
| `availability.quietHours` | `{start,end}` SGT `\| null` | `null` |
| `dm.access` | `everyone \| members \| admins` | `everyone` |
| `dm.maintenanceReply` | `string \| null` | see below |
| `dm.deniedReply` | `string \| null` | see below |

Default reply texts:

- `dm.maintenanceReply` — `"I'm paused right now — I'll be back shortly."`
- `dm.deniedReply` — `"This bot is for MSOCIETY members."`

**`availability.quietHours` suppresses chime-ins only.** Direct questions
(a mention, a reply to the bot, or a DM) are always answered — someone asking at
1am wants an answer, they just don't want the bot volunteering one. Scheduled
broadcasts are out of v1 scope and already sit at 9am SGT, so nothing else falls
inside the window. The hours are evaluated in `Asia/Singapore`, matching the
crons in `digest-scheduler.ts`, and a window may wrap midnight
(`{start: "23:00", end: "07:00"}`).

**Pause is a state, not a boolean plus a timer.** `paused_until{date}` expires by
comparison at read time — no cron to run, and it survives a Railway restart.
`paused` is indefinite.

**`ai.replies` and `ai.background` are independent.** Pausing replies silences
the bot to members while Monday's tech news still goes out; pausing background
stops every cron and extraction job while members keep talking to the bot. A cost
spike usually calls for both; a noisy release calls for the first only.

**Mute is AI-only.** Deterministic commands (`/events`, `/projects`, `/usage`,
`/login`) keep working under any pause state. Pausing is about cost and noise,
not about taking the bot offline.

**`dm.access` is hierarchical and independent of the pause.** It gates *who*;
the pause gates *whether*. Levels:

- `everyone` — any Telegram user (current behaviour)
- `members` — has a member record and is not banned
- `admins` — members blocked too

Unlike the pause, `dm.access` gates **everything** in DMs including commands: a
stranger has no business running `/events`. Because `membershipMiddleware`
already restricts auto-registration to group and supergroup chats
(`auto-register.ts:134-137`), a member record only ever comes from group
activity — so "is a member" is exact, and a stranger who has never been in the
group is cleanly blocked at `members`.

**Admins always pass both gates.** This is the escape hatch: without it,
`dm.access = admins` combined with a pause would lock you out of the menu that
unlocks it.

Two denial texts because the reasons differ — `dm.maintenanceReply` is "I'm
paused", `dm.deniedReply` is "you're not allowed". Setting either to `null` gives
silence. Both are rate-limited to once per user per 10 minutes via an in-memory
map, the same pattern as the chime-in cooldown in `chime-in.ts`, so a member
pasting five messages does not receive five identical replies.

### cost

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `cost.dailyCapUsd` | `number \| null` | `10` | — |
| `cost.monthlyCapUsd` | `number \| null` | `150` | — |
| `cost.advisorDailyBudgetUsd` | `number` | `0.5` | `ADVISOR_DAILY_BUDGET_USD` |
| `cost.advisorMaxTier` | `off \| big \| bigger` | `bigger` | — |
| `cost.alertThresholdUsd` | `number \| null` | `null` | — |

`cost.alertThresholdUsd` is a warning, not a limit: when the running daily total
crosses it, the bot DMs every admin once and does not alert again until the next
UTC day. Nothing is blocked — that is what the caps are for.

`null` on a cap means unlimited. `cost.advisorMaxTier = off` disables the
escalation tiers entirely and is the blunt panic button; an explicit "economy
mode" was considered and cut, because it overlapped almost entirely with this key
and two knobs that can contradict each other is worse than one.

**The `10` and `150` defaults are placeholders.** They must be set from observed
spend before this ships — run `/usage all` and set each to roughly 2x the
observed peak, so a cap never fires on an ordinary day. This is a required step
in the implementation plan, not a nice-to-have.

### behaviour

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `chimeIn.enabled` | `boolean` | `true` | — |
| `chimeIn.cooldownMinutes` | `number` | `30` | `CHIME_IN_COOLDOWN_MS` |
| `chimeIn.minConfidence` | `number` 0–1 | `0.8` | `CHIME_IN_MIN_CONFIDENCE` |
| `memory.extractionEnabled` | `boolean` | `true` | — |
| `research.webEnabled` | `boolean` | `true` | — |

### welcome

| Key | Type | Default |
| --- | --- | --- |
| `welcome.enabled` | `boolean` | `true` |
| `welcome.newMemberText` | `string` template | current copy, below |
| `welcome.returningText` | `string` template | current copy, below |
| `welcome.showProfileButton` | `boolean` | `true` |

`welcome.enabled = false` silences **both** greetings — the new-joiner message and
the rejoin message. `membersService.claimWelcome(userId)` is still called either
way, so a member greeted-while-disabled is not greeted again later when it is
re-enabled; the existing double-greet guard keeps its meaning.

Defaults are lifted verbatim from `auto-register.ts:97-113` and the rejoin branch:

```
welcome.newMemberText:
  Welcome to MSOCIETY, {name}! 👋

  Would you mind doing a short intro?
  1. Some background of your academics
  2. Your current job/situation
  3. Your tech interests/aspirations

welcome.returningText:
  Welcome back, {name}! 👋
```

Templates support `{name}` (rendered as a tappable `tg://user?id=` mention),
`{first_name}`, and `{username}`. An unrecognised placeholder is left literal
rather than erroring — an admin typo should look wrong, not break the greeting.

**Escaping rule: store raw, escape only what's interpolated.** The admin's own
markup is stored verbatim and validated by preview-send; the values substituted
into it (member names) are always HTML-escaped, so a member calling themselves
`<script>` cannot break the message. Blanket-escaping the admin's text was
rejected because it would destroy their intentional `<b>` and `<a>` tags.

Because validation is the preview, **`Edit` requires a successful preview before
it will offer Confirm**. If Telegram rejects the HTML, the save is refused and
the previous value stands — a broken tag can never reach a real joiner.

## Menu

`/settings` is DM-only. In a group it replies with a deep link to the DM rather
than paginating settings in front of five hundred people.

Pagination is **by group**, so each page is a coherent section rather than an
arbitrary slice: four groups, four pages, with the arrows moving between them.

```
⚙️  Bot Settings · Availability          1/4     │  AI replies
                                                  │
 [ AI replies · active ]                          │  Whether the bot answers members in chat.
 [ Background AI · active ]              ──────▶  │  Commands (/events, /login) keep working
 [ Quiet hours · off ]                            │  either way. Background jobs are a
 [ DM access · everyone ]                         │  separate switch.
 [ Paused reply · custom ]                        │
 [ Denied reply · default ]                       │  Current:  ● active
 [ ‹ Welcome ]      [ Cost › ]                    │  Default:  active
                                                  │  Changed:  never
                                                  │
                                                  │  [ Pause 1h ] [ 4h ] [ 24h ]
       ┌──────────────────────────────────┐       │  [ Pause indefinitely ]
       │  ✓ Updated — AI replies          │ ◀──── │  [ History ]      [ ‹ Back ]
       │                                  │       │
       │  active → paused until 17:42 SGT │
       │                                  │
       │  [ Undo ]   [ ‹ Settings ]       │
       └──────────────────────────────────┘
```

The setting page shows the registry `description`, the current value, the
default, and when it last changed. `Undo` on the confirmation page is free — the
page already holds the previous value.

### Callback data budget

Telegram caps `callback_data` at 64 bytes. The longest generated callback,
`set:edit:cost.advisorDailyBudgetUsd:0.5`, fits — but only just. **A unit test
asserts every callback the registry can generate stays under the limit**, so the
constraint is enforced permanently as keys are added rather than discovered in
production.

Namespace:

| Callback | Meaning |
| --- | --- |
| `set:idx:<group>` | index page for a group |
| `set:view:<key>` | setting detail page |
| `set:edit:<key>:<value>` | apply a value, then show confirmation |
| `set:reset:<key>` | reset to registry default |
| `set:undo:<key>` | revert to the previous value |
| `set:hist:<key>:<page>` | per-key change history |
| `set:draft:drop:<i>` | remove one change from an AI draft |
| `set:draft:confirm` / `set:draft:cancel` | apply or discard a draft |
| `set:draft:undo` | revert every change from the last applied draft |

`set:edit` carries a value only for the non-text controls. Text settings go
through the conversation flow described below and never encode their value in a
callback.

**Undo carries no value.** It looks up the most recent `audit_log` row for that
key and reverts to its `oldValue`. Encoding the previous value in the callback
was rejected: it cannot work for text settings, where a welcome template is
comfortably longer than the entire 64-byte budget. `set:draft:undo` works the
same way against the inverse change set, which is written to the session when a
draft is applied.

### Text settings

Text values cannot travel in callback data at all, so `Edit` opens a grammY
conversation — the `conversations` plugin is already registered in `init.ts` —
which captures the admin's next message as the value. For the welcome templates,
`Preview` sends the rendered message to the admin's DM exactly as a joiner would
see it, which doubles as the HTML validation described above.

## AI draft flow

Three tools on the main agent. Following the convention already set by
`get_fund_overview`, they are always registered and check the caller's ability
*inside* the tool rather than being conditionally attached.

| Tool | Writes? | Purpose |
| --- | --- | --- |
| `get_settings` | no | current values, defaults, descriptions |
| `propose_settings_change` | no | validate and build a draft; render the card |
| `get_settings_history` | no | read the audit trail |

**No AI tool writes.** `propose_settings_change` validates each key against its
registry schema, computes the current value for each, stores a draft, and renders
a card. Nothing changes until a button is pressed — the same code path the menu
uses, with the AI merely pre-filling it.

```
you: chime-ins are too noisy this week and spend is up,
     cut the cooldown to an hour and drop the cap to $4

┌─ 📝 Proposed changes (3) ──────────────┐    ┌─ ✓ Applied 3 changes ─────────────────┐
│                                        │    │                                       │
│   Chime-ins           on   →  off      │    │   Chime-ins           on   →  off   ✓ │
│   Chime-in cooldown   30m  →  60m      │──▶ │   Chime-in cooldown   30m  →  60m   ✓ │
│   Community daily cap $10  →  $4       │    │   Community daily cap $10  →  $4    ✓ │
│                                        │    │                                       │
│   "Cutting noise and spend for the     │    │  [ Undo all ]     [ ⚙️  Settings ]     │
│    exam period."                       │    └───────────────────────────────────────┘
│                                        │
│  [ ✕ Chime-ins ] [ ✕ Cooldown ] [ ✕ Cap ]
│  [ ✓ Confirm all ]      [ Cancel ]     │
└────────────────────────────────────────┘
```

Dropping a row edits the card in place via `editMessageText` and recomputes it,
so a proposal can be whittled down before committing.

### Draft storage

`ctx.session.settingsDraft`, already Postgres-backed through
`PostgresSessionStorage`. The session is keyed per chat, and since settings are
DM-only, per-chat is per-admin.

```ts
interface SettingsDraft {
  changes: Array<{ key: string; from: unknown; to: unknown }>;
  rationale?: string;
  createdAt: number;
  /** So the card can be edited in place as rows are dropped. */
  messageId: number;
}
```

Applying a draft also writes its inverse to `ctx.session.lastAppliedDraft`, which
is what `set:draft:undo` reverts. It is overwritten by the next applied draft, so
only the most recent one is undoable — matching the single-step `Undo` on the
menu's confirmation page.

### Two deliberate decisions

**Drift is checked at confirm, not at propose.** The draft records each change's
`from` value. If one of those is changed through the menu between proposing and
confirming, confirm does not apply blindly: it re-renders the card with the
drifted rows marked and asks again. Drafts also expire after 10 minutes, and a
stale draft reports itself as expired rather than applying old intent.

**Propose replaces the draft; it does not merge.** When the admin says "also turn
off memory extraction", the agent is instructed to restate the complete set.
Merging would accumulate state that neither the admin nor the model can fully
see, and the card would drift from what the admin believes they asked for.

Confirm applies every change in a single transaction, writes one audit row per
change, and invalidates the cache once.

## Audit

No new table. Every applied change writes one `audit_log` row:

| Column | Value |
| --- | --- |
| `entityType` | `"bot_setting"` |
| `entityId` | the setting key |
| `action` | `"update" \| "reset" \| "undo"` |
| `oldValue` | `{ value: <previous> }` |
| `newValue` | `{ value: <new>, source: "menu" \| "ai_draft", rationale?: string }` |
| `performedBy` | `user.id` of the admin who pressed the button |

The value payload is a bag rather than a bare scalar so provenance rides along.
This follows the precedent already set in `auto-register.ts`, which puts
`{ source, telegramId, ... }` into `newValue`. A dedicated `source` column on
`audit_log` would be cleaner in isolation, but `audit_log` is shared across
entities and the migration is not worth it for one consumer.

Undo writes a **new** row rather than deleting the original, so the trail never
rewrites itself.

Two read surfaces over the same rows:

- **Per-setting** — the `Changed:` line on a setting page comes from
  `bot_settings.updated_by/updated_at` (cheap, no join). A `History` button pages
  through that key's audit rows: `chime-ins · on → off · @aziz · 3 Aug · via AI`.
- **Global** — a `Recent changes` entry on the index showing the last 20 across
  all keys.

`get_settings_history` reads the same data, so the AI can answer "who turned off
chime-ins?".

## Enforcement

The organising principle is **two central gates, not twenty scattered checks**.

Every AI call already funnels through `ai.service` with a `caller` string — that
is what populates `ai_usage.caller`. So `ai.background` and all three cost caps
are enforced in one pre-dispatch gate there, rather than being sprinkled across
four cron callbacks, the memory extractor, the profile regenerator and the
tech-news service. An explicit `class: 'interactive' | 'background'` parameter is
added to the call signature so the gate is type-checked rather than inferred by
string-matching caller names.

| Setting | Enforced in | Change |
| --- | --- | --- |
| `ai.replies` | `bot/handlers/ai-chat.ts` | early return; admin bypass in DM |
| `ai.background`, `cost.dailyCapUsd`, `cost.monthlyCapUsd`, `cost.alertThresholdUsd` | `services/ai.service.ts` | one pre-dispatch gate |
| `cost.advisorDailyBudgetUsd`, `cost.advisorMaxTier` | `bot/ai/advisor-access.ts` | extend `decideAccess` input |
| `chimeIn.*`, `availability.quietHours` | `ai-chat.ts:shouldChimeIn` | pass values in |
| `dm.access` | new middleware in `bot/init.ts` | registered early |
| `memory.extractionEnabled` | `bot/lib/memory-extractor.ts` | guard |
| `research.webEnabled` | `bot/ai/tools.ts` research tool | refusal string |
| `welcome.*` | `bot/lib/auto-register.ts:sendWelcome` | template render |

Two of these need almost no new code. `decideAccess` in `advisor-access.ts` is
already a pure function taking a plain input object, so the budget and max tier
join its arguments and its existing tests extend naturally. `offCooldown` and
`applyConfidenceGate` in `chime-in.ts` already take their thresholds as
parameters with defaults — enforcement is just passing the configured values
instead of relying on those defaults.

### Behaviour when gated

A blocked mention in the **group** is dropped silently. The bot simply looks
offline: no noise, and no confusion about whether it is broken or restricted.

A blocked message in a **DM** gets the relevant reply text
(`dm.maintenanceReply` or `dm.deniedReply`), rate-limited as described above,
because silence in a one-to-one chat reads as a fault.

### Middleware ordering

The `dm.access` gate registers immediately after the group guard in `init.ts`,
ahead of the message logger, photo sync, session and conversations. A blocked
stranger should not cause a profile-photo fetch, a logged message row, or a
session write.

## Access control

Add `"Settings"` to the CASL `Subjects` union in
`packages/shared/src/abilities.ts`:

- `superadmin` — already covered by `can('manage', 'all')`
- `admin` — `can('read', 'Settings')`, `can('update', 'Settings')`
- `member` — nothing

The registry's per-setting `minRole` layers on top, so locking `cost.*` to
superadmin later is a one-word edit per entry rather than a permissions
refactor.

## Testing

Decisions live in pure functions and I/O stays thin, matching how `chime-in.ts`,
`advisor-access.ts` and `pending-question.ts` are already built.

| Test | Covers |
| --- | --- |
| `bot-settings.test.ts` (shared) | every default parses against its own schema; every generated callback ≤64 bytes; no empty labels or descriptions |
| `dm-access.test.ts` | `decideDmAccess({ level, role, isMember, banned })` as a table test over all combinations, pinning admin-always-passes |
| `settings-draft.test.ts` | build, drop-by-index, drift detection, expiry — no DB, no Telegram |
| `welcome-template.test.ts` | substitution; a member named `<script>` is escaped; unknown placeholder left literal |
| `settings-menu.test.ts` | pure `renderSettingPage(def, value)` → `{ text, keyboard }`, snapshot-tested (the repo already snapshots in `bot/ai/__snapshots__/`) |
| `bot-settings.service.test.ts` | defaults with no row; override merge; reset deletes the row; cache invalidation on write; audit row contents; undo reverts to the latest audit row's `oldValue` and writes a new row rather than deleting |
| `advisor-access.test.ts` | extended for configurable budget and `maxTier` |

## Files

**New:**

- `packages/shared/src/bot-settings.ts` — the registry
- `apps/api/src/services/bot-settings.service.ts` — read, write, cache, audit
- `apps/api/src/bot/handlers/settings.ts` — `/settings`, callbacks, edit conversation
- `apps/api/src/bot/lib/settings-menu.ts` — pure renderers
- `apps/api/src/bot/lib/settings-draft.ts` — pure draft logic
- `apps/api/src/bot/lib/welcome-template.ts` — pure template renderer
- `apps/api/src/bot/lib/dm-access.ts` — pure decision plus middleware

**Modified:**

- `apps/api/src/db/schema/bot.ts` — add `botSettings`
- `packages/shared/src/abilities.ts` — add `"Settings"` subject
- `apps/api/src/bot/init.ts` — register the DM gate and the settings handler
- `apps/api/src/bot/types.ts` — `settingsDraft` and `lastAppliedDraft` on the session
- `apps/api/src/bot/handlers/ai-chat.ts` — pause gate, configurable chime-in
- `apps/api/src/bot/ai/tools.ts` — three settings tools
- `apps/api/src/bot/ai/advisor-access.ts`, `advisor-gate.ts` — configurable budget and tier
- `apps/api/src/services/ai.service.ts` — pre-dispatch gate, spend counter, alerts
- `apps/api/src/bot/lib/auto-register.ts` — templated welcome
- `apps/api/src/bot/lib/memory-extractor.ts` — extraction guard

## Rollout

One Drizzle migration creating `bot_settings`, generated with `drizzle-kit
generate` and committed. Migrations apply on Railway deploy.

The table ships **empty**. Defaults live in code, so behaviour is byte-identical
to today until a setting is changed. The existing constants
(`ADVISOR_DAILY_BUDGET_USD`, `CHIME_IN_COOLDOWN_MS`, `CHIME_IN_MIN_CONFIDENCE`)
stay exported and become the registry's default values, so nothing that imports
them breaks.

After deploy: run `/usage all`, then set `cost.dailyCapUsd` and
`cost.monthlyCapUsd` from observed spend.

## Known limitation: spend cap precision

The cap needs a running daily total, and querying `ai_usage` before every AI call
is too expensive. The design uses an in-process counter seeded on boot and
re-read every ~60 seconds.

If the API ever runs more than one Railway replica, each holds a partial view and
the cap can overshoot by up to a minute's spend before converging. This is
accepted for a soft budget guard. A hard ceiling would require a `SELECT … FOR
UPDATE` per call and real added latency; that trade was considered and declined
for v1.
