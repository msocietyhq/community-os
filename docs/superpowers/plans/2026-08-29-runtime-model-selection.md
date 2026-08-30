# Runtime Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin change which model each AI tier runs on from a Telegram menu or by asking the bot, without a redeploy — and make adding a non-Anthropic provider a one-entry change instead of a refactor.

**Architecture:** A closed catalog in `packages/shared` becomes the single source of truth for every model the bot may run on, carrying everything that differs between providers: price, cache multipliers, the `providerOptions` fragments for cache breakpoints and reasoning effort, the env var it needs, and whether it is trusted with a multi-step tool loop. Four tier settings (`ai.model.micro|fast|smart|deep`) join the existing `BOT_SETTINGS` registry as `choice` controls whose schema is an enum over that catalog — which means "is this a legal value" and "can we price this" become the same check. `ai.service` resolves a tier to a concrete model at call time instead of binding one at module load, so a settings change applies to the next message.

**Tech Stack:** Bun, TypeScript, Zod (v4, workspace catalog), Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`), Drizzle ORM + postgres-js, grammY, `bun test`.

**Spec:** None separate — requirements were settled in conversation and are captured in "Why this shape" below.

---

## Why this shape

Three constraints drove every decision here. Read them before changing the design.

**1. A free-text model id would silently switch off every cost cap.**
`ai-pricing.ts:20-21` already warns: *"A model missing from this map is costed at $0, which would silently defeat the advisor spend cap."* If the setting accepted any string, one typo means `estimateCost()` returns 0 for every call, so `assertWithinBudget` never trips, `cost.dailyCapUsd` and `cost.monthlyCapUsd` stop binding, `cost.advisorDailyBudgetUsd` stops binding, and spend alerts never fire. The bot keeps answering, just uncapped. Hence a closed catalog and a `z.enum` over its keys — the schema check *is* the pricing check.

**2. The tier that runs the chat agent is also the highest-volume tier.**
`agent.ts:165` runs the main agent on `fast` with `stopWhen: stepCountIs(10)` and the full tool suite, and so do all six sub-agents. But `fast` also drives three one-shot `generateObject` callers with no tools — `chime-in-judge.ts:18` (fires on ordinary group traffic, the highest-volume call in the system), `memory-extractor.ts:159`, and `memory-backfill.service.ts:63`. Cost pressure and tool-loop capability pressure land on one setting and pull opposite ways. Task 9 splits the one-shot callers onto a `micro` tier so a very cheap model can take the volume without ever being handed a tool loop. The catalog's `toolLoop` flag is what enforces that split.

**3. The recovery path must never route through the AI.**
An admin can confirm a model change that leaves the bot too weak to call `propose_settings_change` again. That is survivable only because `handlers/settings.ts` imports no AI whatsoever — the menu is `callback_query` → `parseEditValue` → `setSetting`, pure grammY. **Do not add an AI dependency to the settings menu path.** Every model setting's `description` names this recovery route, and that text is surfaced both on the menu page and to the model via `get_settings`.

---

## Conventions for the whole plan

**Running tests.** There is no `test` script in any `package.json`; this repo uses Bun's runner directly. Always run from the repo root:

```bash
bun test <path-to-file>          # one file
bun test apps/api packages       # everything
```

**Test placement.** Colocated as `<name>.test.ts` next to the file under test — follow `apps/api/src/services/ai-cache.test.ts` for style.

**Pure modules stay pure.** `ai-pricing.ts` and `ai-cache.ts` were deliberately split out of `ai.service.ts` because that module imports `db` and `env`, and `env` validates at import time and throws when the test runner has not loaded `apps/api/.env`. Keep new pure logic out of `ai.service.ts` for the same reason.

**No `any`.** `CLAUDE.md` forbids it outright. Use `unknown` plus narrowing, or generics.

**Branch and commits.** The standing preference is to work on `dev` and not to branch or commit unless asked. Commit steps are written in because each task should land as one reviewable unit — **confirm before the first commit**, then follow that answer for the rest. Every commit message ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Task 1's commit step shows this in full; later tasks abbreviate to `git commit -m "..."` — append the same trailer every time.

**No migrations.** This plan adds no columns. Model settings are rows in the existing `bot_settings` table, written through the existing service.

**Pricing numbers are load-bearing.** Every figure in the catalog feeds the cost caps. Tasks 1 and 10 each carry an explicit verification step against the provider's own pricing page. Do not skip it and do not copy figures from memory.

---

## File Structure

**New files:**

| File | Responsibility |
| --- | --- |
| `packages/shared/src/ai-catalog.ts` | The catalog: model ids, labels, pricing, cache multipliers, provider-options fragments, env keys, `toolLoop` flag. Pure data + small helpers. |
| `packages/shared/src/ai-catalog.test.ts` | Catalog invariants (shape, positive pricing, tier filters non-empty, defaults present). |
| `apps/api/src/services/ai-provider.ts` | Lazy, memoised provider-instance registry. Maps a catalog key to a `LanguageModel`. |

**Modified files:**

| File | Change |
| --- | --- |
| `packages/shared/package.json` | Add the `./ai-catalog` export. |
| `packages/shared/src/index.ts` | Re-export the catalog. |
| `packages/shared/src/bot-settings.ts` | Four `ai.model.*` entries in the `cost` group. |
| `packages/shared/src/bot-settings.test.ts` | Extend the 64-byte callback test to cover model option values. |
| `apps/api/src/services/ai-pricing.ts` | Re-key pricing onto catalog keys; keep a legacy alias map for historical `ai_usage` rows; take cache multipliers from the catalog. |
| `apps/api/src/services/ai-pricing.test.ts` | Cover catalog keys, legacy ids and per-provider cache multipliers. |
| `apps/api/src/services/ai-cache.ts` | Take the cache-breakpoint fragment from the catalog instead of hardcoding `anthropic`. |
| `apps/api/src/services/ai-cache.test.ts` | Cover the catalog-driven and no-cache-control paths. |
| `apps/api/src/services/ai.service.ts` | Resolve tier → model at call time; `tier` moves into `TrackingContext`; `model` leaves the params. |
| `apps/api/src/bot/lib/settings-menu.ts` | Render model options for the four new `choice` settings, chunked two per row. |
| `apps/api/src/bot/lib/settings-menu.test.ts` | Snapshot the model setting page. |
| `apps/api/src/bot/ai/tools.ts` | Reasoning effort from the catalog; advisor passes a tier. |
| `apps/api/src/env.ts` | Add `GOOGLE_GENERATIVE_AI_API_KEY` (optional). |
| `apps/api/src/index.ts` | Boot-time catalog usability check. |
| 15 call sites | `model:` in params → `tier:` in the tracking context. Listed in full in Task 6. |

---

## Task 1: The model catalog

Anthropic-only and at exact parity with today's `AI_MODEL_IDS` and `AI_MODEL_PRICING`. No behaviour changes in this task — it only creates the table everything else will read.

**Files:**
- Create: `packages/shared/src/ai-catalog.ts`
- Create: `packages/shared/src/ai-catalog.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Verify the pricing figures**

Open https://www.anthropic.com/pricing and confirm the per-1M-token input/output rates for `claude-haiku-4-5`, `claude-sonnet-5` and `claude-opus-5`, plus the prompt-cache read and write multipliers for the 5-minute TTL.

The values below are what `apps/api/src/services/ai-pricing.ts` currently holds (Haiku $1/$5, Sonnet $3/$15, Opus $5/$25, cache read 0.1x, cache write 1.25x). If the page disagrees, use the page and note the correction in the commit message. Note the existing comment at `ai-pricing.ts:19-21`: Sonnet 5 carried promotional pricing of $2/$10 through 2026-08-31, and the table deliberately records the standard rate so budgets do not under-count once it ends. Preserve that decision.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/ai-catalog.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  AI_CATALOG,
  AI_MODEL_KEYS,
  AI_TIERS,
  DEFAULT_TIER_MODELS,
  modelKeysForTier,
  type AiModelKey,
} from "./ai-catalog";

describe("catalog invariants", () => {
  test("every key is provider/model shaped", () => {
    for (const key of AI_MODEL_KEYS) {
      expect(key, `${key} should be provider/model`).toInclude("/");
      expect(key.startsWith(`${AI_CATALOG[key].provider}/`)).toBe(true);
    }
  });

  test("every model has positive pricing", () => {
    for (const key of AI_MODEL_KEYS) {
      const { input, output } = AI_CATALOG[key].pricing;
      expect(input, `${key} input`).toBeGreaterThan(0);
      expect(output, `${key} output`).toBeGreaterThan(0);
    }
  });

  test("cache multipliers are non-negative", () => {
    for (const key of AI_MODEL_KEYS) {
      const { read, write } = AI_CATALOG[key].cache;
      expect(read, `${key} cache read`).toBeGreaterThanOrEqual(0);
      expect(write, `${key} cache write`).toBeGreaterThanOrEqual(0);
    }
  });

  test("every model declares a non-empty env key", () => {
    for (const key of AI_MODEL_KEYS) {
      expect(AI_CATALOG[key].envKey.length, `${key} envKey`).toBeGreaterThan(0);
    }
  });

  // Labels sit on Telegram buttons next to other text; long ones wrap badly.
  test("every label is short enough for a button", () => {
    for (const key of AI_MODEL_KEYS) {
      expect(AI_CATALOG[key].label.length, `${key} label`).toBeLessThanOrEqual(20);
    }
  });
});

describe("modelKeysForTier", () => {
  test("every tier has at least one selectable model", () => {
    for (const tier of AI_TIERS) {
      expect(modelKeysForTier(tier).length, `${tier}`).toBeGreaterThan(0);
    }
  });

  // The chat agent and every sub-agent run ten-step tool loops on these tiers.
  test("tool-loop tiers only offer tool-loop models", () => {
    for (const tier of ["fast", "smart", "deep"] as const) {
      for (const key of modelKeysForTier(tier)) {
        expect(AI_CATALOG[key].toolLoop, `${key} on ${tier}`).toBe(true);
      }
    }
  });

  test("micro offers every model, tool-loop or not", () => {
    expect(modelKeysForTier("micro").length).toBe(AI_MODEL_KEYS.length);
  });
});

describe("DEFAULT_TIER_MODELS", () => {
  test("every tier has a default that is selectable for it", () => {
    for (const tier of AI_TIERS) {
      const chosen: AiModelKey = DEFAULT_TIER_MODELS[tier];
      expect(modelKeysForTier(tier), `${tier} default`).toContain(chosen);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
bun test packages/shared/src/ai-catalog.test.ts
```

Expected: FAIL — `Cannot find module './ai-catalog'`.

- [ ] **Step 4: Write the catalog**

Create `packages/shared/src/ai-catalog.ts`:

```ts
/**
 * The closed set of models the bot may run on, and everything that differs
 * between them.
 *
 * This is a catalog rather than a free-text model id on purpose. Every cost cap
 * in the system is computed from `pricing`, and `estimateCost` prices an unknown
 * model at $0 — so a model outside this table would silently switch off the
 * daily cap, the monthly cap and the per-member advisor budget while the bot
 * carried on answering. Making the tier settings an enum over these keys makes
 * "is this a legal value" and "can we price this" the same check.
 */

export const AI_PROVIDERS = ["anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface ModelDef {
  provider: AiProvider;
  /** The id this provider's own SDK expects. */
  modelId: string;
  /** Menu label. Sits on a Telegram button, so keep it short. */
  label: string;
  /** USD per 1M tokens. */
  pricing: { input: number; output: number };
  /**
   * Multipliers on the input rate for cached tokens. `{ read: 1, write: 1 }`
   * means the provider does not price cached tokens differently.
   */
  cache: { read: number; write: number };
  /**
   * A `providerOptions` fragment placing a cache breakpoint at the end of the
   * prompt, or null when the provider caches implicitly and takes no flag.
   */
  cacheControl: Record<string, unknown> | null;
  /**
   * A `providerOptions` fragment per reasoning level, or null when the model
   * has no effort knob.
   */
  reasoning: {
    medium: Record<string, unknown>;
    high: Record<string, unknown>;
  } | null;
  /** Env var that must hold a key for this model to be usable. */
  envKey: string;
  /**
   * Whether this model is trusted with a multi-step tool loop. The main chat
   * agent runs ten steps with the full tool suite; a model that fumbles that
   * must not be selectable for the tiers driving it.
   */
  toolLoop: boolean;
}

/** Identity helper so each entry is checked while staying a literal. */
const model = (d: ModelDef): ModelDef => d;

/** Anthropic bills a cache read at 0.1x and a 5-minute write at 1.25x. */
const ANTHROPIC_CACHE = { read: 0.1, write: 1.25 };

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

const ANTHROPIC_REASONING = {
  medium: { anthropic: { effort: "medium" } },
  high: { anthropic: { effort: "high" } },
};

export const AI_CATALOG = {
  "anthropic/haiku-4-5": model({
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    label: "Haiku 4.5",
    pricing: { input: 1.0, output: 5.0 },
    cache: ANTHROPIC_CACHE,
    cacheControl: ANTHROPIC_CACHE_CONTROL,
    reasoning: ANTHROPIC_REASONING,
    envKey: "ANTHROPIC_API_KEY",
    toolLoop: true,
  }),
  "anthropic/sonnet-5": model({
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    label: "Sonnet 5",
    // Standard rate, not the promotional $2/$10 that ran to 2026-08-31 —
    // budgets must not under-count once a promotion ends.
    pricing: { input: 3.0, output: 15.0 },
    cache: ANTHROPIC_CACHE,
    cacheControl: ANTHROPIC_CACHE_CONTROL,
    reasoning: ANTHROPIC_REASONING,
    envKey: "ANTHROPIC_API_KEY",
    toolLoop: true,
  }),
  "anthropic/opus-5": model({
    provider: "anthropic",
    modelId: "claude-opus-5",
    label: "Opus 5",
    pricing: { input: 5.0, output: 25.0 },
    cache: ANTHROPIC_CACHE,
    cacheControl: ANTHROPIC_CACHE_CONTROL,
    reasoning: ANTHROPIC_REASONING,
    envKey: "ANTHROPIC_API_KEY",
    toolLoop: true,
  }),
} satisfies Record<string, ModelDef>;

export type AiModelKey = keyof typeof AI_CATALOG;

/**
 * Typed as a non-empty tuple so it can seed a `z.enum` directly — the same
 * trick `SETTING_KEYS` uses. The catalog is a literal and is never empty, so
 * the assertion is safe by construction.
 */
export const AI_MODEL_KEYS = Object.keys(AI_CATALOG) as [
  AiModelKey,
  ...AiModelKey[],
];

/**
 * `micro` is one-shot structured output with no tools — the chime-in judge,
 * the memory extractor and the memory backfill. `fast` runs the main chat
 * agent and every sub-agent in a ten-step tool loop. `smart` and `deep` are
 * the advisor escalations and the long-form background jobs.
 */
export const AI_TIERS = ["micro", "fast", "smart", "deep"] as const;
export type AiTier = (typeof AI_TIERS)[number];

/** Tiers that hand the model a multi-step tool loop. */
const TOOL_LOOP_TIERS: readonly AiTier[] = ["fast", "smart", "deep"];

export function isToolLoopTier(tier: AiTier): boolean {
  return TOOL_LOOP_TIERS.includes(tier);
}

/**
 * Which models may be selected for a tier.
 *
 * A cheap model that cannot hold a ten-step tool conversation is perfectly
 * good at judging one chat message, so it stays available to `micro` while
 * being filtered out of the tiers that would break with it.
 */
export function modelKeysForTier(tier: AiTier): [AiModelKey, ...AiModelKey[]] {
  const keys = isToolLoopTier(tier)
    ? AI_MODEL_KEYS.filter((k) => AI_CATALOG[k].toolLoop)
    : [...AI_MODEL_KEYS];
  return keys as [AiModelKey, ...AiModelKey[]];
}

/** The tier defaults. Exact parity with the previous hardcoded AI_MODEL_IDS. */
export const DEFAULT_TIER_MODELS: Record<AiTier, AiModelKey> = {
  micro: "anthropic/haiku-4-5",
  fast: "anthropic/haiku-4-5",
  smart: "anthropic/sonnet-5",
  deep: "anthropic/opus-5",
};
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test packages/shared/src/ai-catalog.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Wire up the package exports**

In `packages/shared/package.json`, add to the `exports` map after the `"./bot-settings"` line:

```json
    "./ai-catalog": "./src/ai-catalog.ts"
```

In `packages/shared/src/index.ts`, add after the existing exports:

```ts
export * from "./ai-catalog";
```

- [ ] **Step 7: Type-check and commit**

```bash
bun type-check
bun test packages
```

Expected: both clean.

```bash
git add packages/shared/src/ai-catalog.ts packages/shared/src/ai-catalog.test.ts \
        packages/shared/package.json packages/shared/src/index.ts
git commit -m "feat: add a closed model catalog in shared

Every cost cap is computed from a model's price, and estimateCost prices an
unknown model at \$0 — so a free-text model id would silently switch off the
daily cap, the monthly cap and the advisor budget. A closed catalog makes the
schema check and the pricing check the same check.

Anthropic-only and at exact parity with the previous hardcoded ids; no
behaviour change yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Price by catalog key, keep history intact

`ai_usage` holds ~months of rows keyed by raw provider ids like `claude-sonnet-4-5-20250929`. Re-keying pricing onto catalog keys must not turn historical spend into $0.

**Files:**
- Modify: `apps/api/src/services/ai-pricing.ts`
- Modify: `apps/api/src/services/ai-pricing.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/services/ai-pricing.test.ts` (keep the existing tests; they cover the legacy ids and must keep passing):

```ts
import { AI_CATALOG } from "@community-os/shared/ai-catalog";

describe("catalog-keyed pricing", () => {
  test("prices a catalog key", () => {
    // Sonnet 5: $3 in / $15 out per 1M.
    expect(estimateCost("anthropic/sonnet-5", 1_000_000, 0)).toBeCloseTo(3, 5);
    expect(estimateCost("anthropic/sonnet-5", 0, 1_000_000)).toBeCloseTo(15, 5);
  });

  test("still prices a retired raw id, so historical rows are not zeroed", () => {
    expect(estimateCost("claude-sonnet-4-5-20250929", 1_000_000, 0)).toBeCloseTo(3, 5);
  });

  test("applies the catalog's cache multipliers, not a hardcoded pair", () => {
    // 1M input of which 1M was a cache read, at 0.1x → $0.30 for Sonnet.
    expect(
      estimateCost("anthropic/sonnet-5", 1_000_000, 0, 1_000_000, 0),
    ).toBeCloseTo(0.3, 5);
    // 1M input of which 1M was a cache write, at 1.25x → $3.75.
    expect(
      estimateCost("anthropic/sonnet-5", 1_000_000, 0, 0, 1_000_000),
    ).toBeCloseTo(3.75, 5);
  });

  test("an unknown model is still $0", () => {
    expect(estimateCost("nonesuch/model", 1_000_000, 1_000_000)).toBe(0);
  });

  test("every catalog key prices above zero", () => {
    for (const key of Object.keys(AI_CATALOG)) {
      expect(estimateCost(key, 1_000_000, 0), key).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test apps/api/src/services/ai-pricing.test.ts
```

Expected: FAIL — `estimateCost("anthropic/sonnet-5", ...)` returns 0.

- [ ] **Step 3: Rewrite `ai-pricing.ts`**

Replace the whole file with:

```ts
/**
 * Token pricing.
 *
 * Split out from ai.service so the arithmetic can be tested directly: that
 * module pulls in the database and `env`, which validates at import time and
 * throws when the test runner hasn't loaded apps/api/.env.
 *
 * Live rates come from the shared catalog. This module only adds the legacy
 * table: `ai_usage` rows written before the catalog existed are keyed by raw
 * provider ids, and renaming a model must not rewrite the past.
 */

import { AI_CATALOG } from "@community-os/shared/ai-catalog";

interface Rate {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

/** Anthropic bills a cache read at 0.1x and a 5-minute write at 1.25x. */
const ANTHROPIC_CACHE = { read: 0.1, write: 1.25 };

/**
 * Raw provider ids that historical `ai_usage` rows still reference. Without
 * these, past spend silently reports as $0 in the usage views.
 */
const LEGACY_RATES: Record<string, Rate> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cache: ANTHROPIC_CACHE },
  "claude-sonnet-5": { input: 3.0, output: 15.0, cache: ANTHROPIC_CACHE },
  "claude-opus-5": { input: 5.0, output: 25.0, cache: ANTHROPIC_CACHE },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cache: ANTHROPIC_CACHE },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cache: ANTHROPIC_CACHE },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cache: ANTHROPIC_CACHE },
};

function rateFor(model: string): Rate | null {
  const entry = AI_CATALOG[model as keyof typeof AI_CATALOG];
  if (entry) {
    return {
      input: entry.pricing.input,
      output: entry.pricing.output,
      cache: entry.cache,
    };
  }
  return LEGACY_RATES[model] ?? null;
}

/**
 * `inputTokens` is the whole prompt; `cacheRead`/`cacheWrite` are slices of it,
 * so the remainder is what was billed at the base rate. Pricing the whole
 * prompt at 1.0x over-charges reads by 10x and under-charges writes by a
 * quarter, which quietly moves the budget caps.
 *
 * Both cache arguments default to 0 so rows written before those columns
 * existed price exactly as they did then.
 *
 * A model in neither table is costed at $0. That would defeat the spend caps,
 * so it must stay unreachable: every tier setting is an enum over the catalog,
 * and the catalog is the only way a new model can be selected.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const rate = rateFor(model);
  if (!rate) return 0;

  const uncachedTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const inputUnits =
    uncachedTokens +
    cacheReadTokens * rate.cache.read +
    cacheWriteTokens * rate.cache.write;

  return (inputUnits * rate.input + outputTokens * rate.output) / 1_000_000;
}
```

Note what is deliberately gone: `AI_MODEL_IDS`, `AI_MODEL_PRICING`, `CACHE_READ_RATE` and `CACHE_WRITE_RATE`. The catalog owns all four now.

- [ ] **Step 4: Fix the existing test imports**

`ai-pricing.test.ts` imports `AI_MODEL_IDS` at line 5 and uses it at line 7. Replace those two lines:

```ts
import { estimateCost } from "./ai-pricing";

const SONNET = "anthropic/sonnet-5"; // $3 in / $15 out per 1M
```

- [ ] **Step 5: Run the tests**

```bash
bun test apps/api/src/services/ai-pricing.test.ts
```

Expected: PASS. Every previously existing test still passes — that is the point of `LEGACY_RATES`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ai-pricing.ts apps/api/src/services/ai-pricing.test.ts
git commit -m "refactor: price from the catalog, keep legacy ids priced

ai_usage rows predating the catalog are keyed by raw provider ids. Dropping
them from the pricing table would silently report months of historical spend
as \$0 in the usage views."
```

---

## Task 3: Catalog-driven prompt caching

`withPromptCaching` hardcodes the `anthropic` provider-options key. It becomes a function of the model.

**Files:**
- Modify: `apps/api/src/services/ai-cache.ts`
- Modify: `apps/api/src/services/ai-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `describe("withPromptCaching", ...)` block in `apps/api/src/services/ai-cache.test.ts` with:

```ts
import { AI_CATALOG } from "@community-os/shared/ai-catalog";

const ANTHROPIC = AI_CATALOG["anthropic/haiku-4-5"];

/** A stand-in for a provider that caches implicitly and takes no flag. */
const IMPLICIT = { ...ANTHROPIC, cacheControl: null };

describe("withPromptCaching", () => {
  test("leaves a tool-free call alone", () => {
    const result = withPromptCaching(params({ tools: {} }), ANTHROPIC);
    expect(cacheControlOf(result)).toBeUndefined();
  });

  test("adds a breakpoint to a call that can loop", () => {
    const result = withPromptCaching(params({ tools: { search: {} } }), ANTHROPIC);
    expect(cacheControlOf(result)).toEqual({ type: "ephemeral" });
  });

  test("adds nothing when the model caches implicitly", () => {
    const result = withPromptCaching(params({ tools: { search: {} } }), IMPLICIT);
    expect(result.providerOptions?.anthropic).toBeUndefined();
  });

  test("preserves an unrelated provider option", () => {
    const result = withPromptCaching(
      params({
        tools: { search: {} },
        providerOptions: { anthropic: { effort: "high" } },
      }),
      ANTHROPIC,
    );
    const opts = (
      result.providerOptions as { anthropic: Record<string, unknown> }
    ).anthropic;
    expect(opts.effort).toBe("high");
    expect(opts.cacheControl).toEqual({ type: "ephemeral" });
  });

  test("an explicit cacheControl from the caller wins", () => {
    const result = withPromptCaching(
      params({
        tools: { search: {} },
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      }),
      ANTHROPIC,
    );
    expect(cacheControlOf(result)).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});
```

Keep the existing `params` and `cacheControlOf` helpers at the top of the file (lines 10-18) and the existing `describe("cacheSplit", ...)` block unchanged.

- [ ] **Step 2: Run to verify it fails**

```bash
bun test apps/api/src/services/ai-cache.test.ts
```

Expected: FAIL — `withPromptCaching` takes one argument.

- [ ] **Step 3: Rewrite `withPromptCaching`**

In `apps/api/src/services/ai-cache.ts`, add the import and replace the function. The long doc comment above it stays exactly as it is — it records measurements that are still true — but append the paragraph shown below.

```ts
import type { ModelDef } from "@community-os/shared/ai-catalog";
```

```ts
/**
 * ... existing doc comment, unchanged ...
 *
 * Which fragment to merge is now the model's business, not this function's: a
 * provider that caches implicitly declares `cacheControl: null` in the catalog
 * and gets nothing added.
 */
export function withPromptCaching(
  params: GenerateTextParams,
  def: ModelDef,
): GenerateTextParams {
  if (def.cacheControl === null) return params;
  if (Object.keys(params.tools ?? {}).length === 0) return params;

  const merged: Record<string, unknown> = { ...params.providerOptions };

  for (const [provider, fragment] of Object.entries(def.cacheControl)) {
    const existing = merged[provider];
    merged[provider] = {
      ...(fragment as Record<string, unknown>),
      ...(typeof existing === "object" && existing !== null ? existing : {}),
    };
  }

  return { ...params, providerOptions: merged as GenerateTextParams["providerOptions"] };
}
```

The spread order matters and matches the old behaviour: the caller's own `providerOptions` land second, so an explicit `cacheControl` still wins.

- [ ] **Step 4: Run the tests**

```bash
bun test apps/api/src/services/ai-cache.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai-cache.ts apps/api/src/services/ai-cache.test.ts
git commit -m "refactor: take the cache breakpoint from the catalog

A provider that caches implicitly declares cacheControl: null and gets no
flag, rather than this function assuming Anthropic."
```

---

## Task 4: The four tier settings

**Files:**
- Modify: `packages/shared/src/bot-settings.ts`
- Modify: `packages/shared/src/bot-settings.test.ts`

- [ ] **Step 1: Write the failing test**

The existing 64-byte callback test only covers the `view`/`reset`/`undo` prefixes, which carry no value. Model options ride in an `edit` callback with the catalog key appended, which is far longer. Add to `packages/shared/src/bot-settings.test.ts` inside `describe("registry invariants", ...)`:

```ts
  // An edit callback carries the chosen value, so it is much longer than the
  // value-free prefixes above. A model key like "anthropic/haiku-4-5" pushes
  // hardest, and Telegram fails the ENTIRE message if any callback is over 64.
  test("every model option's edit callback fits in 64 bytes", () => {
    for (const tier of AI_TIERS) {
      const key = `ai.model.${tier}` as SettingKey;
      for (const value of modelKeysForTier(tier)) {
        const data = callbackFor("edit", key, value);
        expect(
          Buffer.byteLength(data, "utf8"),
          `${data} is too long`,
        ).toBeLessThanOrEqual(64);
      }
    }
  });

  test("every tier setting is registered", () => {
    for (const tier of AI_TIERS) {
      expect(SETTING_KEYS, `ai.model.${tier}`).toContain(`ai.model.${tier}`);
    }
  });
```

Extend the file's imports at the top:

```ts
import { AI_TIERS, modelKeysForTier } from "./ai-catalog";
```

and add `type SettingKey` to the existing import from `./bot-settings`.

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/shared/src/bot-settings.test.ts
```

Expected: FAIL — `SETTING_KEYS` does not contain `ai.model.micro`.

- [ ] **Step 3: Add the settings**

In `packages/shared/src/bot-settings.ts`, add to the imports at the top:

```ts
import {
  AI_CATALOG,
  DEFAULT_TIER_MODELS,
  modelKeysForTier,
  type AiModelKey,
} from "./ai-catalog";
```

Then add these four entries to `BOT_SETTINGS`, at the end of the `// ── cost ──` section (after `"cost.alertThresholdUsd"`):

```ts
  "ai.model.micro": def<AiModelKey>({
    schema: z.enum(modelKeysForTier("micro")),
    default: DEFAULT_TIER_MODELS.micro,
    label: "Micro model",
    description:
      "One-shot judgement calls with no tools: the chime-in judge, the memory extractor and the backfill. The judge runs on ordinary group traffic, so this is the highest-volume tier and the cheapest place to save money. A weak model here costs nothing worse than a poor chime-in decision.",
    group: "cost",
    control: "choice",
    format: (v) => AI_CATALOG[v].label,
  }),
  "ai.model.fast": def<AiModelKey>({
    schema: z.enum(modelKeysForTier("fast")),
    default: DEFAULT_TIER_MODELS.fast,
    label: "Fast model",
    description:
      "The main chat agent and every sub-agent, each running up to ten tool-calling steps. Only models vetted for tool loops are offered here. If a change leaves the bot unable to hold a conversation, change it back from this menu — the menu never asks the AI anything.",
    group: "cost",
    control: "choice",
    format: (v) => AI_CATALOG[v].label,
  }),
  "ai.model.smart": def<AiModelKey>({
    schema: z.enum(modelKeysForTier("smart")),
    default: DEFAULT_TIER_MODELS.smart,
    label: "Smart model",
    description:
      "The first advisor escalation, plus the long-form background jobs — digests, tech news and profile regeneration. Recoverable from this menu if a change goes badly.",
    group: "cost",
    control: "choice",
    format: (v) => AI_CATALOG[v].label,
  }),
  "ai.model.deep": def<AiModelKey>({
    schema: z.enum(modelKeysForTier("deep")),
    default: DEFAULT_TIER_MODELS.deep,
    label: "Deep model",
    description:
      "The deepest advisor escalation, charged against each member's advisor budget. The most expensive model per call, though far from the largest share of the bill. Recoverable from this menu.",
    group: "cost",
    control: "choice",
    format: (v) => AI_CATALOG[v].label,
  }),
```

- [ ] **Step 4: Run the tests**

```bash
bun test packages/shared
```

Expected: PASS. The pre-existing invariant tests now also cover the four new entries — defaults parse, descriptions exceed 20 characters, group is known, formats do not throw.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bot-settings.ts packages/shared/src/bot-settings.test.ts
git commit -m "feat: register the four AI tier models as settings

They join the cost group because the model choice is the largest cost lever
in the system. Each schema is an enum over the models the catalog allows for
that tier, so a tool-loop tier can never be pointed at a model that cannot
hold a tool conversation."
```

---

## Task 5: Render model choices in the menu

**Files:**
- Modify: `apps/api/src/bot/lib/settings-menu.ts`
- Modify: `apps/api/src/bot/lib/settings-menu.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/bot/lib/settings-menu.test.ts`:

```ts
import { AI_CATALOG, modelKeysForTier } from "@community-os/shared/ai-catalog";

describe("model setting page", () => {
  test("offers every model allowed for the tier, by label", () => {
    const page = renderSettingPage("ai.model.fast", snapshot(), null);
    const labels = page.keyboard.inline_keyboard.flat().map((b) => b.text);

    for (const key of modelKeysForTier("fast")) {
      expect(labels, key).toContain(AI_CATALOG[key].label);
    }
  });

  test("never puts more than two models on a row", () => {
    const page = renderSettingPage("ai.model.micro", snapshot(), null);
    const modelLabels = new Set(
      modelKeysForTier("micro").map((k) => AI_CATALOG[k].label),
    );

    for (const row of page.keyboard.inline_keyboard) {
      const onRow = row.filter((b) => modelLabels.has(b.text));
      expect(onRow.length).toBeLessThanOrEqual(2);
    }
  });
});
```

Use whatever helper the existing tests in this file use to build a `SettingsSnapshot`; if there is none, add:

```ts
import { BOT_SETTINGS, SETTING_KEYS, type SettingsSnapshot } from "@community-os/shared/bot-settings";

function snapshot(): SettingsSnapshot {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) out[key] = BOT_SETTINGS[key].default;
  return out as SettingsSnapshot;
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test apps/api/src/bot/lib/settings-menu.test.ts
```

Expected: FAIL — the `choice` branch falls through to `QUIET_HOUR_PRESETS` and renders `off`, `23:00-07:00`, `22:00-08:00`.

- [ ] **Step 3: Extend the `choice` branch**

In `apps/api/src/bot/lib/settings-menu.ts`, add to the imports:

```ts
import {
  AI_CATALOG,
  AI_TIERS,
  modelKeysForTier,
  type AiTier,
} from "@community-os/shared/ai-catalog";
```

Add above `renderSettingPage`:

```ts
/** `ai.model.fast` → `fast`, or null for any other key. */
function tierOf(key: SettingKey): AiTier | null {
  const suffix = key.startsWith("ai.model.") ? key.slice("ai.model.".length) : null;
  return AI_TIERS.find((t) => t === suffix) ?? null;
}
```

Replace the `case "choice"` block (currently `settings-menu.ts:186-197`) with:

```ts
    case "choice": {
      const tier = tierOf(key);
      if (tier) {
        // Two per row: model labels are far wider than `everyone` or `off`,
        // and the catalog only grows.
        const keys = modelKeysForTier(tier);
        keys.forEach((modelKey, i) => {
          keyboard.text(AI_CATALOG[modelKey].label, editCallback(key, modelKey));
          if (i % 2 === 1) keyboard.row();
        });
        if (keys.length % 2 === 1) keyboard.row();
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
```

`settings-parse.ts` needs no change: its `choice` branch already falls through to `candidate = raw` for anything that is not `availability.quietHours`, and the registry schema validates the key.

- [ ] **Step 4: Run the tests**

```bash
bun test apps/api/src/bot/lib/settings-menu.test.ts apps/api/src/bot/lib/settings-parse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bot/lib/settings-menu.ts apps/api/src/bot/lib/settings-menu.test.ts
git commit -m "feat: render model options on the tier setting pages

Two buttons per row — model labels are much wider than the other choice
settings' values, and the catalog only grows."
```

---

## Task 6: Resolve the tier at call time

The largest task. `AI_MODELS` is built once at import (`ai.service.ts:27-31`); settings are async, so the binding has to move to the call.

The tier moves into the tracking context rather than staying in the params, for two reasons: `trackUsage` then records the catalog key instead of the raw provider id, which keeps the pricing join working; and the model is resolved exactly once per `generateText` call, so a settings change can never land between two steps of the same tool loop.

**Files:**
- Create: `apps/api/src/services/ai-provider.ts`
- Modify: `apps/api/src/services/ai.service.ts`
- Modify: `apps/api/src/env.ts`
- Modify: 15 call sites, listed in Step 5

- [ ] **Step 1: Add the provider registry**

Create `apps/api/src/services/ai-provider.ts`:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import {
  AI_CATALOG,
  type AiModelKey,
  type AiProvider,
} from "@community-os/shared/ai-catalog";
import { env } from "../env";

type ProviderFn = (modelId: string) => LanguageModel;

/**
 * Built lazily and memoised: a provider whose key is absent must not throw at
 * import time just because some other provider's model was selected.
 */
const FACTORIES: Record<AiProvider, () => ProviderFn> = {
  anthropic: () => {
    const provider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return (modelId) => provider(modelId);
  },
};

const memo = new Map<AiProvider, ProviderFn>();

/** Whether the env var a model needs actually holds a value. */
export function hasCredentials(key: AiModelKey): boolean {
  const value = process.env[AI_CATALOG[key].envKey];
  return typeof value === "string" && value.length > 0;
}

export function modelFor(key: AiModelKey): LanguageModel {
  const def = AI_CATALOG[key];
  let factory = memo.get(def.provider);
  if (!factory) {
    factory = FACTORIES[def.provider]();
    memo.set(def.provider, factory);
  }
  return factory(def.modelId);
}
```

- [ ] **Step 2: Replace the model map with a resolver in `ai.service.ts`**

Delete the provider block at `ai.service.ts:23-31` (the `createAnthropic` call and the `AI_MODELS` object), the `export { AI_MODEL_IDS }` at line 21, and the `resolveModelId` function at lines 66-70. Replace the imports at lines 1-2 and 16 with:

```ts
import { generateText, generateObject } from "ai";
import {
  AI_CATALOG,
  AI_TIERS,
  DEFAULT_TIER_MODELS,
  type AiModelKey,
  type AiTier,
  type ModelDef,
} from "@community-os/shared/ai-catalog";
import { estimateCost } from "./ai-pricing";
import { hasCredentials, modelFor } from "./ai-provider";
```

Add, in place of the deleted provider block:

```ts
// ── Tier resolution ─────────────────────────────────────────

interface ResolvedTier {
  /** The catalog key. This is what gets written to `ai_usage.model`. */
  key: AiModelKey;
  def: ModelDef;
  model: ReturnType<typeof modelFor>;
}

/**
 * A tier's model is read per call rather than bound at import, so a settings
 * change applies to the next message without a redeploy. Reading it here also
 * pins the model for the whole of one `generateText` — a change can never land
 * between two steps of the same tool loop.
 *
 * An unusable selection falls back to the tier default with a warning rather
 * than throwing, matching `buildSnapshot`: a bad row in the settings table
 * must never be able to take the bot down.
 */
async function resolveTier(tier: AiTier): Promise<ResolvedTier> {
  const settings = await getSettings();
  const chosen = settings[`ai.model.${tier}`];

  if (!hasCredentials(chosen)) {
    const fallback = DEFAULT_TIER_MODELS[tier];
    console.warn(
      `[ai] ${tier} is set to ${chosen} but ${AI_CATALOG[chosen].envKey} is not set — falling back to ${fallback}`,
    );
    return { key: fallback, def: AI_CATALOG[fallback], model: modelFor(fallback) };
  }

  return { key: chosen, def: AI_CATALOG[chosen], model: modelFor(chosen) };
}

/** Reports which tiers are pointed at a model this deployment cannot run. */
export function unusableTiers(
  snapshot: Record<`ai.model.${AiTier}`, AiModelKey>,
): { tier: AiTier; key: AiModelKey; envKey: string }[] {
  const out: { tier: AiTier; key: AiModelKey; envKey: string }[] = [];
  for (const tier of AI_TIERS) {
    const key = snapshot[`ai.model.${tier}`];
    if (!hasCredentials(key)) {
      out.push({ tier, key, envKey: AI_CATALOG[key].envKey });
    }
  }
  return out;
}
```

- [ ] **Step 3: Move `tier` into the tracking context**

In `ai.service.ts`, add to `TrackingContext` (line 35):

```ts
export interface TrackingContext {
  caller: string;
  /** Which tier to run on. Resolved to a concrete model per call. */
  tier: AiTier;
  telegramUserId?: number | null;
  chatId?: string | null;
  class?: CallClass;
}
```

- [ ] **Step 4: Rewrite the two wrappers**

`model` leaves the params and the resolved one is injected. Change the signature and the first few lines of `trackedGenerateText` (line 134):

```ts
async function trackedGenerateText(
  params: Omit<Parameters<typeof generateText>[0], "model">,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  await assertWithinBudget(ctx);

  const { key: modelId, def, model } = await resolveTier(ctx.tier);
  const start = performance.now();

  try {
    const result = await generateText(withPromptCaching({ ...params, model }, def));
```

Everything below that in the function is unchanged — `modelId` now holds the catalog key, so both `recordSpend` and `trackUsage` record it.

Change `trackedGenerateObject` (line 189) the same way, minus the caching call, which it deliberately does not use:

```ts
async function trackedGenerateObject<
  T extends Omit<Parameters<typeof generateObject>[0], "model">,
>(
  params: T,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateObject>>> {
  await assertWithinBudget(ctx);

  const { key: modelId, model } = await resolveTier(ctx.tier);
  const start = performance.now();

  try {
    // Deliberately not cached: a structured-output call is one-shot by
    // construction, so a cache write here could never be read back.
    const result = await generateObject({ ...params, model });
```

Finally, in the exported service object at line 546, delete the `models:` and `modelIds:` lines. `aiService.modelIds` has no consumers; `aiService.models` is replaced by the `tier` field.

- [ ] **Step 5: Migrate all 15 call sites**

Each is the same edit: delete the `model:` line from the params object, add `tier:` to the context object. The tier for each is the one it used before.

| File:line | Old | New context field |
| --- | --- | --- |
| `apps/api/src/bot/ai/agent.ts:165` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/github.ts:145` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/members.ts:137` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/projects.ts:167` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/venues.ts:129` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/research.ts:364` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/ai/agents/events.ts:160` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/lib/chime-in-judge.ts:18` | `models.fast` | `tier: "fast"` |
| `apps/api/src/bot/lib/memory-extractor.ts:159` | `models.fast` | `tier: "fast"` |
| `apps/api/src/services/memory-backfill.service.ts:63` | `models.fast` | `tier: "fast"` |
| `apps/api/src/services/digest.service.ts:426` | `models.smart` | `tier: "smart"` |
| `apps/api/src/services/ai-profile.service.ts:307` | `models.smart` | `tier: "smart"` |
| `apps/api/src/services/tech-news.service.ts:495` | `models.smart` | `tier: "smart"` |
| `apps/api/src/scripts/backfill-events.ts:132` | `models.smart` | `tier: "smart"` |
| `apps/api/src/bot/ai/tools.ts:163` | ternary | `tier: tier === "bigger" ? "deep" : "smart"` |

The three that move to `micro` are handled in Task 9 — leave them on `fast` here so this task changes no behaviour.

Worked example, `apps/api/src/bot/ai/agent.ts:163-173`:

```ts
    const result = await aiService.generateText(
      {
        system,
        messages,
        tools: trackedTools,
        stopWhen: stepCountIs(10),
        maxOutputTokens: 1024,
      },
      {
        caller: "main-agent",
        tier: "fast",
        telegramUserId: senderTelegramId,
        chatId,
      },
    );
```

And `apps/api/src/bot/ai/tools.ts:161-178`, where the local variable `tier` is the advisor tier (`"big"` / `"bigger"`), not an `AiTier` — do not shadow it:

```ts
  const result = await aiService.generateText(
    {
      system: advisorSystemPrompt(tier),
      messages: buildAdvisorMessages(conversation, problem),
      tools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: ADVISOR_MAX_OUTPUT_TOKENS,
      providerOptions: {
        anthropic: { effort: tier === "bigger" ? "high" : "medium" },
      },
    },
    {
      caller: ADVISOR_TOOL_NAMES[tier],
      tier: tier === "bigger" ? "deep" : "smart",
      telegramUserId: ctx.senderTelegramId,
      chatId: ctx.chatId,
    },
  );
```

The hardcoded `providerOptions` stays for now; Task 7 replaces it.

- [ ] **Step 6: Type-check**

```bash
bun type-check
```

Expected: clean. If a call site was missed, this is where it surfaces — `model` is no longer accepted in params and `tier` is required in the context, so both directions of the mistake are compile errors.

- [ ] **Step 7: Run the full suite**

```bash
bun test apps/api packages
```

Expected: PASS.

- [ ] **Step 8: Verify against the running bot**

```bash
bun run --cwd apps/api dev
```

Send the bot a DM. Confirm in the logs that `[main-agent]` completes, then check the model recorded:

```sql
SELECT model, caller, created_at FROM ai_usage ORDER BY created_at DESC LIMIT 5;
```

Expected: `model` now reads `anthropic/haiku-4-5`, not `claude-haiku-4-5`. Historical rows keep their old ids and still price correctly via `LEGACY_RATES`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/ai-provider.ts apps/api/src/services/ai.service.ts \
        apps/api/src/bot apps/api/src/services apps/api/src/scripts
git commit -m "feat: resolve a tier to a model per call, not at import

The tier moves into the tracking context so ai_usage records the catalog key
rather than the raw provider id, which keeps the pricing join intact, and so
the model is pinned once per generateText — a settings change can never land
between two steps of the same tool loop."
```

---

## Task 7: Reasoning effort from the catalog

**Files:**
- Modify: `apps/api/src/bot/ai/tools.ts`
- Modify: `apps/api/src/services/ai.service.ts`

- [ ] **Step 1: Accept a reasoning level in the context**

In `ai.service.ts`, add to `TrackingContext`:

```ts
  /**
   * Reasoning effort, translated per model by the catalog. Ignored by models
   * with no effort knob.
   */
  reasoning?: "medium" | "high";
```

In `trackedGenerateText`, after resolving the tier and before the `generateText` call, merge the fragment:

```ts
    const withReasoning =
      ctx.reasoning && def.reasoning
        ? {
            ...params,
            providerOptions: {
              ...def.reasoning[ctx.reasoning],
              ...params.providerOptions,
            },
          }
        : params;

    const result = await generateText(
      withPromptCaching({ ...withReasoning, model }, def),
    );
```

- [ ] **Step 2: Drop the hardcoded fragment from the advisor**

In `apps/api/src/bot/ai/tools.ts`, remove the `providerOptions` block from the `runAdvisor` params and put the level in the context instead:

```ts
  const result = await aiService.generateText(
    {
      system: advisorSystemPrompt(tier),
      messages: buildAdvisorMessages(conversation, problem),
      tools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: ADVISOR_MAX_OUTPUT_TOKENS,
    },
    {
      caller: ADVISOR_TOOL_NAMES[tier],
      tier: tier === "bigger" ? "deep" : "smart",
      reasoning: tier === "bigger" ? "high" : "medium",
      telegramUserId: ctx.senderTelegramId,
      chatId: ctx.chatId,
    },
  );
```

- [ ] **Step 3: Type-check, test, verify**

```bash
bun type-check
bun test apps/api packages
```

Expected: clean and PASS.

Then, with the bot running, ask it something that triggers an advisor escalation and confirm `[ask_bigger_advisor]` still logs a step count and token usage.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bot/ai/tools.ts apps/api/src/services/ai.service.ts
git commit -m "refactor: translate reasoning effort per model via the catalog

Every provider names the effort knob differently; the advisor should not have
to know which one it is talking to."
```

---

## Task 8: Boot-time usability check

Catches a settings row pointing at a model this deployment has no key for, at start-up rather than in front of a member.

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add the check at boot**

In `apps/api/src/index.ts`, after the server starts listening (match the surrounding style for where start-up logging goes), add:

```ts
import { getSettings } from "./services/bot-settings.service";
import { unusableTiers } from "./services/ai.service";
```

```ts
// A tier pointed at a model this deployment has no key for still answers —
// resolveTier falls back to the tier default — but it does so silently. Say so
// once at boot, where someone will see it.
getSettings()
  .then((settings) => {
    for (const { tier, key, envKey } of unusableTiers(settings)) {
      console.warn(
        `[ai] ${tier} is set to ${key} but ${envKey} is not set — that tier will fall back to its default`,
      );
    }
  })
  .catch((err) => console.error("[ai] tier check failed:", err));
```

- [ ] **Step 2: Verify**

```bash
bun run --cwd apps/api dev
```

Expected: no `[ai]` warnings, since every catalog entry needs `ANTHROPIC_API_KEY` and it is set.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: warn at boot when a tier points at an unusable model"
```

---

## Task 9: Split the one-shot callers onto the micro tier

Three callers use `fast` but never hand the model a tool. Moving them lets a cheap model take the largest share of the volume without ever facing a tool loop.

**Files:**
- Modify: `apps/api/src/bot/lib/chime-in-judge.ts:18`
- Modify: `apps/api/src/bot/lib/memory-extractor.ts:159`
- Modify: `apps/api/src/services/memory-backfill.service.ts:63`

- [ ] **Step 1: Confirm all three are tool-free**

```bash
grep -n "tools\|generateObject\|generateText" \
  apps/api/src/bot/lib/chime-in-judge.ts \
  apps/api/src/bot/lib/memory-extractor.ts \
  apps/api/src/services/memory-backfill.service.ts
```

Expected: all three call `generateObject` and none passes `tools`. **If any one of them does pass tools, leave it on `fast`** — the whole justification for `micro` is that it never sees a tool loop.

- [ ] **Step 2: Change the three tiers**

In each file, change the tracking context's `tier: "fast"` to `tier: "micro"`. Nothing else changes.

- [ ] **Step 3: Test and verify**

```bash
bun type-check
bun test apps/api packages
```

Then run the bot, post a question in the group that should trigger a chime-in judgement, and confirm:

```sql
SELECT caller, model, count(*) FROM ai_usage
WHERE created_at > now() - interval '10 minutes'
GROUP BY caller, model;
```

Expected: `chime-in-judge` appears with the micro tier's model.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bot/lib/chime-in-judge.ts \
        apps/api/src/bot/lib/memory-extractor.ts \
        apps/api/src/services/memory-backfill.service.ts
git commit -m "refactor: move the tool-free callers to the micro tier

The chime-in judge runs on ordinary group traffic and is the highest-volume
call in the system, but it is one-shot structured output with no tools. It
does not need the model that drives the ten-step agent loop."
```

---

## Task 10: Add Google as a second provider

The first non-Anthropic entry. Everything above exists so that this task is a catalog entry plus a factory.

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/src/services/ai-provider.ts`
- Modify: `packages/shared/src/ai-catalog.ts`

- [ ] **Step 1: Verify the pricing and the cache behaviour**

Open https://ai.google.dev/gemini-api/docs/pricing and record, for `gemini-2.5-flash-lite`:
- input and output USD per 1M tokens (expected around $0.10 / $0.40 — **use the page, not this number**)
- the cached-input rate, as a multiplier of the base input rate, for the `read` field
- whether context caching requires an explicit request; Gemini caches implicitly, so `cacheControl` is expected to be `null` and `cache.write` to be `1`

Record what the page says in the commit message.

- [ ] **Step 2: Install the provider**

```bash
bun add --cwd apps/api @ai-sdk/google
```

- [ ] **Step 3: Add the env var**

In `apps/api/src/env.ts`, add to the schema:

```ts
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
```

Optional, not required: a deployment running only Anthropic models must still boot. Add the same line to `apps/api/.env.example` with an empty value and a short comment.

- [ ] **Step 4: Add the factory**

In `apps/api/src/services/ai-provider.ts`:

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
```

```ts
  google: () => {
    const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[ai-provider] GOOGLE_GENERATIVE_AI_API_KEY is not set",
      );
    }
    const provider = createGoogleGenerativeAI({ apiKey });
    return (modelId) => provider(modelId);
  },
```

`hasCredentials` already guards this, so the throw is a backstop rather than the normal path.

- [ ] **Step 5: Add the catalog entry**

In `packages/shared/src/ai-catalog.ts`, add `"google"` to `AI_PROVIDERS`, then add the entry using the figures verified in Step 1:

```ts
  "google/gemini-2-5-flash-lite": model({
    provider: "google",
    modelId: "gemini-2.5-flash-lite",
    label: "Gemini Flash-Lite",
    pricing: { input: 0.1, output: 0.4 },
    // Gemini caches implicitly: a read is discounted, and there is no write
    // surcharge because there is no write to request.
    cache: { read: 0.25, write: 1 },
    cacheControl: null,
    reasoning: null,
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    // Not yet vetted for the ten-step agent loop. Keeping this false is what
    // confines it to `micro`, where a tool is never passed.
    toolLoop: false,
  }),
```

- [ ] **Step 6: Run the tests**

```bash
bun test packages apps/api
bun type-check
```

Expected: PASS. The catalog invariant tests now assert the new entry's shape, and `modelKeysForTier` keeps it out of `fast`, `smart` and `deep` — verify that by reading the test output for `tool-loop tiers only offer tool-loop models`.

- [ ] **Step 7: Switch the micro tier and measure**

Set `GOOGLE_GENERATIVE_AI_API_KEY` in `apps/api/.env`, restart, then in a DM to the bot: `/settings` → Cost → Micro model → Gemini Flash-Lite.

Watch a few chime-in judgements land, then compare quality and cost against the previous day:

```sql
SELECT model, count(*) AS calls,
       sum(input_tokens) AS in_tokens,
       sum(output_tokens) AS out_tokens
FROM ai_usage
WHERE caller = 'chime-in-judge' AND created_at > now() - interval '2 days'
GROUP BY model;
```

If chime-in decisions get noticeably worse, change it back from the same menu — three taps, no redeploy. That is the whole point of the design.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/env.ts apps/api/.env.example \
        apps/api/src/services/ai-provider.ts packages/shared/src/ai-catalog.ts bun.lock
git commit -m "feat: add Google as a second provider

Gemini Flash-Lite is confined to the micro tier by toolLoop: false until it
has been vetted for the agent's ten-step loop. Pricing verified against
ai.google.dev on 2026-08-29."
```

---

## Self-review notes

**Covered:** runtime model switching without redeploy (Tasks 4, 5, 6); cost-cap integrity under model change (Tasks 1, 2); the lockout hazard (Task 4's descriptions, the `toolLoop` filter in Task 1, and the untouched AI-free menu path); historical spend preservation (Task 2); provider portability (Tasks 3, 7, 10); the cost win (Tasks 9, 10).

**Deliberately not built:**
- *Filtering unusable models out of the menu.* `resolveTier` falls back with a warning and Task 8 reports it at boot, which matches how `buildSnapshot` already handles a bad row. Adding an env-aware filter would mean threading env state into `settings-menu.ts`, which is currently a pure renderer that imports only from `shared`.
- *Per-tier spend attribution in the usage views.* `ai_usage.model` now holds the catalog key, so this is a query away, but no view asks for it yet.
- *A Vercel AI Gateway provider.* The catalog makes it one more entry in `FACTORIES` plus entries whose `modelId` is a gateway string. Worth doing only if direct keys become a problem.

**Watch during execution:** Task 6 is the only one that can break the bot for members. Its Step 6 type-check is the real safety net — both halves of a missed call site are compile errors, so a clean `bun type-check` means every site moved.
