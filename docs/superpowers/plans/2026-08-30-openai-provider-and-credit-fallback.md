# OpenAI Provider and Credit-Exhaustion Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI as a third AI provider, and keep the bot answering when a provider's prepaid credit runs out by substituting a working model, telling admins once, and recovering on its own.

**Architecture:** Detection is a pure error classifier; provider state lives in a new `provider_health` table so it survives deploys; substitution happens at model-resolution time in `pickModelKey` so the admin's `ai.model.*` setting is never overwritten and recovery is automatic. The two `tracked*` wrappers in `ai.service.ts` get one retry on a re-resolved model. Admin notification reuses the existing settings-menu callbacks rather than building a second picker.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (postgres-js), grammY, Vercel AI SDK (`ai` v6, `@ai-sdk/openai` v4), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-30-provider-fallback-design.md`

**Ground rules for this plan:**
- Never use `any` (repo rule). Use `unknown` + narrowing.
- Never run `drizzle-kit push`. Use `bun db:generate` then commit the SQL file.
- Run tests from `apps/api` (`cd apps/api && bun test`) — `env.ts` parses `process.env` at import and needs `apps/api/.env` loaded.
- Type-check with `bun run --cwd apps/api type-check` and `bun run --cwd packages/shared type-check`.

---

### Task 1: OpenAI models in the shared catalog

**Files:**
- Modify: `packages/shared/src/ai-catalog.ts`
- Test: `packages/shared/src/ai-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/ai-catalog.test.ts`:

```ts
describe("openai entries", () => {
  const OPENAI_KEYS = [
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-sol",
  ] as const;

  test("all three models are in the catalog", () => {
    for (const key of OPENAI_KEYS) {
      expect(AI_MODEL_KEYS).toContain(key);
      expect(AI_CATALOG[key].provider).toBe("openai");
    }
  });

  test("pricing matches OpenAI's published rates", () => {
    expect(AI_CATALOG["openai/gpt-5.6-luna"].pricing).toEqual({
      input: 0.2,
      output: 1.2,
    });
    expect(AI_CATALOG["openai/gpt-5.6-terra"].pricing).toEqual({
      input: 2.0,
      output: 12.0,
    });
    expect(AI_CATALOG["openai/gpt-5.6-sol"].pricing).toEqual({
      input: 4.0,
      output: 20.0,
    });
  });

  // A write is billed at 1.25x, like Anthropic and unlike DeepSeek. Copying
  // DeepSeek's `write: 1` would under-count every cache write by 25% and the
  // spend caps are computed from this number.
  test("cache multipliers are 0.1x read and 1.25x write", () => {
    for (const key of OPENAI_KEYS) {
      expect(AI_CATALOG[key].cache, key).toEqual({ read: 0.1, write: 1.25 });
    }
  });

  // GPT-5.6+ caches implicitly and prices both modes identically, so there is
  // no fragment worth sending.
  test("declares no cache-control fragment", () => {
    for (const key of OPENAI_KEYS) {
      expect(AI_CATALOG[key].cacheControl, key).toBeNull();
    }
  });

  test("reasoning maps to the openai effort knob", () => {
    for (const key of OPENAI_KEYS) {
      expect(AI_CATALOG[key].reasoning, key).toEqual({
        medium: { openai: { reasoningEffort: "medium" } },
        high: { openai: { reasoningEffort: "high" } },
      });
    }
  });

  test("all three read OPENAI_API_KEY", () => {
    for (const key of OPENAI_KEYS) {
      expect(AI_CATALOG[key].envKey, key).toBe("OPENAI_API_KEY");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && bun test src/ai-catalog.test.ts`
Expected: FAIL — `AI_MODEL_KEYS` does not contain `openai/gpt-5.6-luna`.

- [ ] **Step 3: Add `openai` to the provider union**

In `packages/shared/src/ai-catalog.ts`, replace the `AI_PROVIDERS` line:

```ts
export const AI_PROVIDERS = ["anthropic", "deepseek", "openai"] as const;
```

- [ ] **Step 4: Add the OpenAI shared constants**

In `packages/shared/src/ai-catalog.ts`, directly after the DeepSeek models and before the closing `} satisfies Record<string, ModelDef>;`, first add these constants above `AI_CATALOG` (next to `ANTHROPIC_CACHE`):

```ts
/**
 * OpenAI bills a cache read at 0.1x and a write at 1.25x — the Anthropic
 * shape, not DeepSeek's. GPT-5.6+ prices implicit and explicit caching
 * identically, so `cacheControl` stays null and the model places its own
 * breakpoints.
 */
const OPENAI_CACHE = { read: 0.1, write: 1.25 };

const OPENAI_REASONING = {
  medium: { openai: { reasoningEffort: "medium" } },
  high: { openai: { reasoningEffort: "high" } },
};
```

- [ ] **Step 5: Add the three model entries**

In `packages/shared/src/ai-catalog.ts`, inside `AI_CATALOG` after `"deepseek/v4-pro"`:

```ts
  // Verified against @ai-sdk/openai@4.0.52: all three ids are in the
  // provider's model-id union, and `reasoningEffort` accepts these values.
  "openai/gpt-5.6-luna": model({
    provider: "openai",
    modelId: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    pricing: { input: 0.2, output: 1.2 },
    cache: OPENAI_CACHE,
    cacheControl: null,
    reasoning: OPENAI_REASONING,
    envKey: "OPENAI_API_KEY",
  }),
  "openai/gpt-5.6-terra": model({
    provider: "openai",
    modelId: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    pricing: { input: 2.0, output: 12.0 },
    cache: OPENAI_CACHE,
    cacheControl: null,
    reasoning: OPENAI_REASONING,
    envKey: "OPENAI_API_KEY",
  }),
  "openai/gpt-5.6-sol": model({
    provider: "openai",
    modelId: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    pricing: { input: 4.0, output: 20.0 },
    cache: OPENAI_CACHE,
    cacheControl: null,
    reasoning: OPENAI_REASONING,
    envKey: "OPENAI_API_KEY",
  }),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/shared && bun test src/ai-catalog.test.ts`
Expected: PASS, including the pre-existing invariant tests (labels ≤ 20 chars — "GPT-5.6 Terra" is 13).

- [ ] **Step 7: Type-check**

Run: `bun run --cwd packages/shared type-check`
Expected: no output (success).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ai-catalog.ts packages/shared/src/ai-catalog.test.ts
git commit -m "feat: add OpenAI GPT-5.6 models to the AI catalog

Prices verified against each model's page on developers.openai.com.
Cache writes bill at 1.25x like Anthropic, not 1x like DeepSeek — the
spend caps are computed from this number, so the distinction matters."
```

---

### Task 2: The per-tier fallback order

**Files:**
- Modify: `packages/shared/src/ai-catalog.ts`
- Test: `packages/shared/src/ai-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/ai-catalog.test.ts` (add `TIER_FALLBACK_ORDER` to the import block at the top of the file):

```ts
describe("TIER_FALLBACK_ORDER", () => {
  test("every tier starts with its default model", () => {
    for (const tier of AI_TIERS) {
      expect(TIER_FALLBACK_ORDER[tier][0], tier).toBe(
        DEFAULT_TIER_MODELS[tier],
      );
    }
  });

  test("every entry is a real catalog key", () => {
    for (const tier of AI_TIERS) {
      for (const key of TIER_FALLBACK_ORDER[tier]) {
        expect(AI_MODEL_KEYS, `${tier} → ${key}`).toContain(key);
      }
    }
  });

  test("a tier never lists the same provider twice", () => {
    for (const tier of AI_TIERS) {
      const providers = TIER_FALLBACK_ORDER[tier].map(
        (key) => AI_CATALOG[key].provider,
      );
      expect(new Set(providers).size, tier).toBe(providers.length);
    }
  });

  test("providers appear in preference order: anthropic, openai, deepseek", () => {
    const rank = { anthropic: 0, openai: 1, deepseek: 2 } as const;
    for (const tier of AI_TIERS) {
      const ranks = TIER_FALLBACK_ORDER[tier].map(
        (key) => rank[AI_CATALOG[key].provider],
      );
      expect([...ranks].sort((a, b) => a - b), tier).toEqual(ranks);
    }
  });

  // micro is entirely generateObject, and DeepSeek has no native JSON-schema
  // mode — the SDK falls back to pasting the schema into the prompt.
  test("micro never falls back to deepseek", () => {
    for (const key of TIER_FALLBACK_ORDER.micro) {
      expect(AI_CATALOG[key].provider).not.toBe("deepseek");
    }
  });

  test("the non-micro tiers cover all three providers", () => {
    for (const tier of ["fast", "smart", "deep"] as const) {
      expect(TIER_FALLBACK_ORDER[tier].length, tier).toBe(3);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && bun test src/ai-catalog.test.ts`
Expected: FAIL — `TIER_FALLBACK_ORDER` is not exported.

- [ ] **Step 3: Implement the table**

In `packages/shared/src/ai-catalog.ts`, immediately after `DEFAULT_TIER_MODELS`:

```ts
/**
 * What a tier runs on when its selected model cannot be used — because the
 * provider has no API key, or has run out of prepaid credit.
 *
 * Read in order, first usable entry wins. The first entry is always
 * `DEFAULT_TIER_MODELS[tier]`, so the ordinary single-outage case is simply
 * "fall back to the tier default"; the rest of the row only matters when that
 * provider is down too. Providers appear in the fixed preference order
 * anthropic → openai → deepseek.
 *
 * This decides the *interim* only. An admin is asked to choose a deliberate
 * replacement in the same minute the outage is detected, and their choice is
 * an ordinary `ai.model.<tier>` setting change.
 *
 * `micro` has no DeepSeek entry for the reason documented on CONFIGURABLE_TIERS:
 * it is entirely `generateObject`, and DeepSeek has no native JSON-schema mode.
 */
export const TIER_FALLBACK_ORDER: Record<
  AiTier,
  readonly [AiModelKey, ...AiModelKey[]]
> = {
  micro: ["anthropic/haiku-4-5", "openai/gpt-5.6-luna"],
  fast: ["anthropic/haiku-4-5", "openai/gpt-5.6-luna", "deepseek/v4-flash"],
  smart: ["anthropic/sonnet-5", "openai/gpt-5.6-terra", "deepseek/v4-pro"],
  deep: ["anthropic/opus-5", "openai/gpt-5.6-sol", "deepseek/v4-pro"],
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/shared && bun test src/ai-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai-catalog.ts packages/shared/src/ai-catalog.test.ts
git commit -m "feat: add TIER_FALLBACK_ORDER to the AI catalog

The interim model a tier runs on when its selection is unusable. First
entry is always the tier default, so a single outage reads as 'fall back
to the default' and the rest only matters when two providers are down."
```

---

### Task 3: OpenAI credentials and provider factory

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/env.ts:12-14`
- Modify: `apps/api/src/services/ai-provider.ts`

- [ ] **Step 1: Install the SDK**

Run: `cd apps/api && bun add @ai-sdk/openai@^4.0.52`
Expected: `installed @ai-sdk/openai@4.0.52`.

- [ ] **Step 2: Add the env var**

In `apps/api/src/env.ts`, after the `DEEPSEEK_API_KEY` line:

```ts
  // Optional for the same reason as DEEPSEEK_API_KEY: a deployment running
  // only Anthropic models must still boot.
  OPENAI_API_KEY: z.string().optional(),
```

- [ ] **Step 3: Add the factory**

In `apps/api/src/services/ai-provider.ts`, add the import at the top:

```ts
import { createOpenAI } from "@ai-sdk/openai";
```

and add this entry to `FACTORIES`, after the `deepseek` entry:

```ts
  openai: () => {
    const apiKey = env.OPENAI_API_KEY;
    // A backstop, not the normal path: `hasCredentials` gates this first and
    // model resolution falls back to a usable model rather than reaching here.
    if (!apiKey) throw new Error("[ai-provider] OPENAI_API_KEY is not set");
    const provider = createOpenAI({ apiKey });
    return (modelId) => provider(modelId);
  },
```

- [ ] **Step 4: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: no output. `FACTORIES` is typed `Record<AiProvider, () => ProviderFn>`, so a missing `openai` key would have been a compile error — this step proves the union and the record agree.

- [ ] **Step 5: Run the full API suite for regressions**

Run: `cd apps/api && bun test`
Expected: all pass (588 before this plan, plus whatever earlier tasks added).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/env.ts apps/api/src/services/ai-provider.ts bun.lock
git commit -m "feat: wire the OpenAI provider factory

OPENAI_API_KEY is optional so a deployment without it still boots, the
same contract DEEPSEEK_API_KEY has."
```

---

### Task 4: Classify a credit-exhaustion error

**Files:**
- Create: `apps/api/src/services/ai-provider-errors.ts`
- Test: `apps/api/src/services/ai-provider-errors.test.ts`

This module must not import `env` or `db` — it is tested directly, and those
throw at import time when the test runner has not loaded `apps/api/.env`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/ai-provider-errors.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { classifyProviderError } from "./ai-provider-errors";

function apiError(opts: {
  statusCode: number;
  message: string;
  body?: unknown;
}): APICallError {
  return new APICallError({
    message: opts.message,
    url: "https://example.test/v1/messages",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: JSON.stringify(opts.body ?? {}),
  });
}

describe("classifyProviderError", () => {
  test("anthropic: 400 with a low credit balance", () => {
    const error = apiError({
      statusCode: 400,
      message:
        "Your credit balance is too low to access the Anthropic API. " +
        "Please go to Plans & Billing to upgrade or purchase credits.",
      body: { type: "error", error: { type: "invalid_request_error" } },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  test("openai: 429 with insufficient_quota", () => {
    const error = apiError({
      statusCode: 429,
      message: "You exceeded your current quota, please check your plan.",
      body: { error: { code: "insufficient_quota", type: "insufficient_quota" } },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  test("deepseek: 402 Insufficient Balance", () => {
    const error = apiError({
      statusCode: 402,
      message: "Insufficient Balance",
      body: { error: { message: "Insufficient Balance" } },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  // The single most important negative case: an ordinary throttling 429 shares
  // a status code with OpenAI's quota error. Only the code tells them apart,
  // and treating a rate limit as an empty account would take a healthy
  // provider out of rotation for up to 24 hours.
  test("an ordinary rate-limit 429 is not credit exhaustion", () => {
    const error = apiError({
      statusCode: 429,
      message: "Rate limit reached for requests",
      body: { error: { code: "rate_limit_exceeded", type: "requests" } },
    });
    expect(classifyProviderError(error)).toBe("other");
  });

  test("a 500 is not credit exhaustion", () => {
    expect(
      classifyProviderError(
        apiError({ statusCode: 500, message: "Internal server error" }),
      ),
    ).toBe("other");
  });

  test("a 401 bad key is not credit exhaustion", () => {
    expect(
      classifyProviderError(
        apiError({ statusCode: 401, message: "invalid x-api-key" }),
      ),
    ).toBe("other");
  });

  test("non-API errors are other", () => {
    expect(classifyProviderError(new Error("boom"))).toBe("other");
    expect(classifyProviderError(undefined)).toBe("other");
    expect(classifyProviderError("Insufficient Balance")).toBe("other");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/services/ai-provider-errors.test.ts`
Expected: FAIL — cannot find module `./ai-provider-errors`.

- [ ] **Step 3: Implement the classifier**

Create `apps/api/src/services/ai-provider-errors.ts`:

```ts
import { APICallError } from "ai";

/**
 * Whether a thrown error means "this provider's prepaid balance is empty".
 *
 * Deliberately free of database and env imports so it can be tested without
 * either, like ai-pricing and ai-cache.
 *
 * Only `out_of_credit` triggers failover. Everything else — rate limits, 5xx,
 * bad keys — propagates unchanged to `lib/retry.ts` and the existing error
 * paths. The distinction matters most for OpenAI, where an empty account and
 * an ordinary throttle share status 429 and differ only by error code.
 */
export type ProviderErrorKind = "out_of_credit" | "other";

/** Anthropic 400 and DeepSeek 402 both say so in the message. */
const CREDIT_MESSAGE = /credit balance is too low|insufficient balance/i;

/** OpenAI signals an empty account with this code on a 429. */
const QUOTA_CODE = /"(?:code|type)"\s*:\s*"insufficient_quota"/;

export function classifyProviderError(error: unknown): ProviderErrorKind {
  if (!APICallError.isInstance(error)) return "other";

  const status = error.statusCode;
  if (status !== 400 && status !== 402 && status !== 429) return "other";

  const body =
    typeof error.responseBody === "string" ? error.responseBody : "";

  if (status === 429) {
    // Status alone is ambiguous here, so the code is the whole signal.
    return QUOTA_CODE.test(body) ? "out_of_credit" : "other";
  }

  return CREDIT_MESSAGE.test(error.message) || CREDIT_MESSAGE.test(body)
    ? "out_of_credit"
    : "other";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/services/ai-provider-errors.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai-provider-errors.ts apps/api/src/services/ai-provider-errors.test.ts
git commit -m "feat: classify provider credit-exhaustion errors

Only an empty account trips failover. An ordinary 429 shares its status
with OpenAI's quota error, so the error code is the whole signal there —
treating a throttle as an empty account would sideline a healthy provider."
```

---

### Task 5: The `provider_health` table

**Files:**
- Create: `apps/api/src/db/schema/provider-health.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create (generated): `apps/api/drizzle/00XX_*.sql`

- [ ] **Step 1: Write the schema**

Create `apps/api/src/db/schema/provider-health.ts`:

```ts
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-provider credit state.
 *
 * A table rather than the module-level Map every other cooldown in this
 * codebase uses. Those can afford to lose their state on deploy; this one
 * cannot. `notified_at` is what stops a multi-day outage from re-DMing every
 * admin after each Railway deploy, and that guarantee is the whole point.
 * A shared table also keeps replicas in agreement.
 *
 * A provider with no row reads as healthy, so no backfill is needed.
 */
export const providerHealth = pgTable("provider_health", {
  /** An AiProvider value: "anthropic" | "openai" | "deepseek". */
  provider: text("provider").primaryKey(),
  /** "healthy" | "out_of_credit". */
  state: text("state").notNull().default("healthy"),
  downSince: timestamp("down_since"),
  /** Earliest next probe. Past this instant, resolution stops substituting. */
  retryAfter: timestamp("retry_after"),
  /** Drives the backoff curve. Reset to 0 on recovery. */
  failureCount: integer("failure_count").notNull().default(0),
  /** Set when the outage DM goes out; the once-per-outage guard. */
  notifiedAt: timestamp("notified_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Export it from the schema barrel**

In `apps/api/src/db/schema/index.ts`, append:

```ts
export * from "./provider-health";
```

- [ ] **Step 3: Generate the migration**

Run: `bun db:generate`
Expected: a new file `apps/api/drizzle/00XX_<name>.sql` containing `CREATE TABLE "provider_health"`.

- [ ] **Step 4: Read the generated SQL and confirm it only creates the table**

Run: `ls -t apps/api/drizzle/*.sql | head -1 | xargs cat`
Expected: a single `CREATE TABLE IF NOT EXISTS "provider_health" (...)`. If it contains any `DROP` or an unrelated `ALTER`, stop and report — that means the local schema had drifted from the migration history and it must not be committed.

- [ ] **Step 5: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema/provider-health.ts apps/api/src/db/schema/index.ts apps/api/drizzle/
git commit -m "feat: add provider_health table

Durable per-provider credit state. Unlike the in-memory cooldowns
elsewhere in the bot, this must survive a deploy: notified_at is what
keeps a multi-day outage from re-DMing admins after every deploy."
```

---

### Task 6: Retry backoff

**Files:**
- Create: `apps/api/src/services/provider-backoff.ts`
- Test: `apps/api/src/services/provider-backoff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/provider-backoff.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { retryDelayMs, BACKOFF_STEPS_MS } from "./provider-backoff";

const MIN = 60_000;

describe("retryDelayMs", () => {
  test("walks 30m, 1h, 2h, 4h, 8h, 24h", () => {
    expect(retryDelayMs(1)).toBe(30 * MIN);
    expect(retryDelayMs(2)).toBe(60 * MIN);
    expect(retryDelayMs(3)).toBe(120 * MIN);
    expect(retryDelayMs(4)).toBe(240 * MIN);
    expect(retryDelayMs(5)).toBe(480 * MIN);
    expect(retryDelayMs(6)).toBe(1440 * MIN);
  });

  // An outage nobody acts on should cost about three probes a day, not 48.
  test("caps at 24 hours", () => {
    expect(retryDelayMs(7)).toBe(1440 * MIN);
    expect(retryDelayMs(99)).toBe(1440 * MIN);
  });

  test("a zero or negative count is treated as the first failure", () => {
    expect(retryDelayMs(0)).toBe(30 * MIN);
    expect(retryDelayMs(-3)).toBe(30 * MIN);
  });

  test("the curve is non-decreasing", () => {
    for (let i = 1; i < BACKOFF_STEPS_MS.length; i++) {
      expect(BACKOFF_STEPS_MS[i]!).toBeGreaterThanOrEqual(
        BACKOFF_STEPS_MS[i - 1]!,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/services/provider-backoff.test.ts`
Expected: FAIL — cannot find module `./provider-backoff`.

- [ ] **Step 3: Implement**

Create `apps/api/src/services/provider-backoff.ts`:

```ts
/**
 * How long a provider stays out of rotation after a failed probe.
 *
 * 30 minutes first so a top-up within the hour is picked up quickly; 24 hours
 * at the cap so an outage nobody acts on costs about three wasted round trips
 * a day instead of forty-eight. A probe is not free: it rides on a real
 * member's call and costs them one failed request before the substitute answers.
 *
 * Pure, so it is tested without a clock or a database.
 */
const MINUTE_MS = 60_000;

export const BACKOFF_STEPS_MS = [
  30 * MINUTE_MS,
  60 * MINUTE_MS,
  120 * MINUTE_MS,
  240 * MINUTE_MS,
  480 * MINUTE_MS,
  1440 * MINUTE_MS,
] as const;

/** @param failureCount consecutive failed probes, 1 for the first failure. */
export function retryDelayMs(failureCount: number): number {
  const index = Math.min(
    Math.max(Math.trunc(failureCount), 1),
    BACKOFF_STEPS_MS.length,
  );
  return BACKOFF_STEPS_MS[index - 1]!;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/services/provider-backoff.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/provider-backoff.ts apps/api/src/services/provider-backoff.test.ts
git commit -m "feat: add provider retry backoff curve

30m to 24h, capped. A probe rides on a real member's call, so the cap
is what keeps an unattended outage from taxing 48 messages a day."
```

---

### Task 7: Pure model resolution

**Files:**
- Create: `apps/api/src/services/model-resolution.ts`
- Test: `apps/api/src/services/model-resolution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/model-resolution.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  AI_CATALOG,
  type AiModelKey,
  type AiProvider,
} from "@community-os/shared/ai-catalog";
import { resolveModelKey } from "./model-resolution";

/** Usable = has a key and its provider still has credit. */
const usableWhen = (healthy: AiProvider[]) => (key: AiModelKey) =>
  healthy.includes(AI_CATALOG[key].provider);

const ALL: AiProvider[] = ["anthropic", "openai", "deepseek"];

describe("resolveModelKey", () => {
  test("returns the selected model when it is usable", () => {
    expect(
      resolveModelKey({
        tier: "smart",
        selected: "deepseek/v4-pro",
        isUsable: usableWhen(ALL),
      }),
    ).toBe("deepseek/v4-pro");
  });

  test("falls back to the tier default when the selection is unusable", () => {
    expect(
      resolveModelKey({
        tier: "smart",
        selected: "deepseek/v4-pro",
        isUsable: usableWhen(["anthropic", "openai"]),
      }),
    ).toBe("anthropic/sonnet-5");
  });

  test("falls to the next provider when the default is also down", () => {
    expect(
      resolveModelKey({
        tier: "smart",
        selected: "deepseek/v4-pro",
        isUsable: usableWhen(["openai"]),
      }),
    ).toBe("openai/gpt-5.6-terra");
  });

  test("micro never resolves to deepseek", () => {
    expect(
      resolveModelKey({
        tier: "micro",
        selected: "anthropic/haiku-4-5",
        isUsable: usableWhen(["deepseek", "openai"]),
      }),
    ).toBe("openai/gpt-5.6-luna");
  });

  test("micro returns null when only deepseek is usable", () => {
    expect(
      resolveModelKey({
        tier: "micro",
        selected: "anthropic/haiku-4-5",
        isUsable: usableWhen(["deepseek"]),
      }),
    ).toBeNull();
  });

  test("returns null when nothing is usable", () => {
    expect(
      resolveModelKey({
        tier: "deep",
        selected: "anthropic/opus-5",
        isUsable: usableWhen([]),
      }),
    ).toBeNull();
  });

  // The selection is tried first even when it sits later in the fallback
  // order — otherwise pointing a tier at DeepSeek would silently run on
  // Anthropic, and the setting would be a lie.
  test("the selection wins over an earlier fallback entry", () => {
    expect(
      resolveModelKey({
        tier: "fast",
        selected: "deepseek/v4-flash",
        isUsable: usableWhen(ALL),
      }),
    ).toBe("deepseek/v4-flash");
  });
});

describe("tiersSelecting", () => {
  const selection: Record<string, AiModelKey> = {
    micro: "anthropic/haiku-4-5",
    fast: "deepseek/v4-flash",
    smart: "deepseek/v4-pro",
    deep: "anthropic/opus-5",
  };
  const selectedFor = (tier: AiTier) => selection[tier]!;

  test("lists every tier pointed at the provider", () => {
    expect(tiersSelecting("deepseek", selectedFor)).toEqual(["fast", "smart"]);
  });

  // micro is pinned in code rather than stored in settings, but an outage on
  // its provider still affects it, so it must be reported.
  test("includes the pinned micro tier", () => {
    expect(tiersSelecting("anthropic", selectedFor)).toEqual(["micro", "deep"]);
  });

  test("returns empty for a provider nothing selects", () => {
    expect(tiersSelecting("openai", selectedFor)).toEqual([]);
  });
});
```

Add `type AiTier` and `tiersSelecting` to this file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/services/model-resolution.test.ts`
Expected: FAIL — cannot find module `./model-resolution`.

- [ ] **Step 3: Implement**

Create `apps/api/src/services/model-resolution.ts`:

```ts
import {
  AI_CATALOG,
  AI_TIERS,
  TIER_FALLBACK_ORDER,
  type AiModelKey,
  type AiProvider,
  type AiTier,
} from "@community-os/shared/ai-catalog";

/**
 * Which model a tier actually runs on, given what is usable right now.
 *
 * Pure — the caller decides what "usable" means (an API key present, the
 * provider not out of credit) and this only walks the order. Tested without a
 * database or `env`, like ai-pricing and ai-cache.
 *
 * The selected model is always tried first, whatever its position in the
 * fallback order. Anything else would mean a tier pointed at DeepSeek could
 * quietly run on Anthropic while `/settings` still claimed otherwise.
 *
 * Returns null when nothing is usable. The caller decides how loudly to fail;
 * returning an unusable model would only move the error somewhere less clear.
 */
export function resolveModelKey(input: {
  tier: AiTier;
  selected: AiModelKey;
  isUsable: (key: AiModelKey) => boolean;
}): AiModelKey | null {
  const { tier, selected, isUsable } = input;

  if (isUsable(selected)) return selected;

  for (const candidate of TIER_FALLBACK_ORDER[tier]) {
    if (isUsable(candidate)) return candidate;
  }

  return null;
}

/**
 * Every tier currently pointed at a provider — what an outage on it affects.
 *
 * Pure for the same reason as the above: the caller supplies the selection,
 * which for configurable tiers comes from settings and for `micro` is pinned
 * in the catalog. `micro` is included deliberately — it cannot be changed by
 * an admin, but an outage on its provider still moves it.
 */
export function tiersSelecting(
  provider: AiProvider,
  selectedFor: (tier: AiTier) => AiModelKey,
): AiTier[] {
  return AI_TIERS.filter(
    (tier) => AI_CATALOG[selectedFor(tier)].provider === provider,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/services/model-resolution.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/model-resolution.ts apps/api/src/services/model-resolution.test.ts
git commit -m "feat: add pure model resolution with fallback order

The selection is always tried first regardless of its position in the
fallback order, so a tier set to DeepSeek can never silently run on
Anthropic while /settings claims otherwise."
```

---

### Task 8: The provider-health service

**Files:**
- Create: `apps/api/src/services/provider-health.service.ts`

No unit test: this is a thin wrapper over one table, in the same category as
`bot-settings.service`'s row access. Its logic — the backoff curve and the
resolution order — is already covered by Tasks 6 and 7. It is exercised end to
end in Task 12.

- [ ] **Step 1: Implement the service**

Create `apps/api/src/services/provider-health.service.ts`:

```ts
import { eq } from "drizzle-orm";
import type { AiProvider } from "@community-os/shared/ai-catalog";
import { db } from "../db";
import { providerHealth } from "../db/schema";
import { retryDelayMs } from "./provider-backoff";

/**
 * Per-provider credit state, read on every AI call and written only when a
 * provider's balance runs out or comes back.
 *
 * Reads are memoised for 30s, matching `getSettings`. Every AI call needs this,
 * and an outage that takes effect up to 30s late costs at most a handful of
 * extra failed calls — each of which fails over correctly anyway, and each of
 * which invalidates the cache on its way through.
 */
const CACHE_TTL_MS = 30_000;

let cached: Map<AiProvider, Row> | null = null;
let cachedAt = 0;

interface Row {
  state: string;
  downSince: Date | null;
  retryAfter: Date | null;
  failureCount: number;
  notifiedAt: Date | null;
}

async function load(): Promise<Map<AiProvider, Row>> {
  const rows = await db
    .select({
      provider: providerHealth.provider,
      state: providerHealth.state,
      downSince: providerHealth.downSince,
      retryAfter: providerHealth.retryAfter,
      failureCount: providerHealth.failureCount,
      notifiedAt: providerHealth.notifiedAt,
    })
    .from(providerHealth);

  return new Map(
    rows.map((row) => [
      row.provider as AiProvider,
      {
        state: row.state,
        downSince: row.downSince,
        retryAfter: row.retryAfter,
        failureCount: row.failureCount,
        notifiedAt: row.notifiedAt,
      },
    ]),
  );
}

function invalidate(): void {
  cached = null;
  cachedAt = 0;
}

/** Test seam and deploy hygiene — the cache is module state. */
export function resetProviderHealthCache(): void {
  invalidate();
}

async function snapshot(now: Date): Promise<Map<AiProvider, Row>> {
  if (cached && now.getTime() - cachedAt < CACHE_TTL_MS) return cached;
  cached = await load();
  cachedAt = now.getTime();
  return cached;
}

/**
 * Providers to route around right now.
 *
 * A provider whose `retry_after` has passed is deliberately NOT in this set:
 * that is exactly how the probe happens. Resolution stops substituting, the
 * next call that wants it tries it for real, and the outcome updates the row.
 */
export async function downProviders(
  now: Date = new Date(),
): Promise<Set<AiProvider>> {
  const rows = await snapshot(now);
  const down = new Set<AiProvider>();

  for (const [provider, row] of rows) {
    if (row.state !== "out_of_credit") continue;
    if (row.retryAfter !== null && row.retryAfter.getTime() <= now.getTime()) {
      continue; // due for a probe
    }
    down.add(provider);
  }

  return down;
}

export interface OutageRecord {
  /** True only for the transition into an outage — the DM guard. */
  firstTransition: boolean;
  failureCount: number;
  retryAfter: Date;
}

/** Records a credit failure and extends the backoff. */
export async function markOutOfCredit(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<OutageRecord> {
  const existing = (await snapshot(now)).get(provider);
  const wasDown = existing?.state === "out_of_credit";
  const failureCount = (wasDown ? existing.failureCount : 0) + 1;
  const retryAfter = new Date(now.getTime() + retryDelayMs(failureCount));
  const firstTransition = !wasDown || existing.notifiedAt === null;

  // `downSince` marks the start of the whole outage, so it is preserved across
  // failed probes and only reset when a new outage begins. The update branch
  // deliberately omits it for that reason.
  await db
    .insert(providerHealth)
    .values({
      provider,
      state: "out_of_credit",
      downSince: wasDown ? (existing.downSince ?? now) : now,
      retryAfter,
      failureCount,
      notifiedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerHealth.provider,
      set: {
        state: "out_of_credit",
        ...(wasDown ? {} : { downSince: now }),
        retryAfter,
        failureCount,
        notifiedAt: now,
        updatedAt: now,
      },
    });

  invalidate();
  return { firstTransition, failureCount, retryAfter };
}

/**
 * Records a successful call.
 *
 * @returns true when this call ended an outage — the recovery DM guard.
 */
export async function markHealthy(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<boolean> {
  const existing = (await snapshot(now)).get(provider);
  if (existing === undefined || existing.state === "healthy") return false;

  await db
    .update(providerHealth)
    .set({
      state: "healthy",
      downSince: null,
      retryAfter: null,
      failureCount: 0,
      notifiedAt: null,
      updatedAt: now,
    })
    .where(eq(providerHealth.provider, provider));

  invalidate();
  return true;
}

/** Clears the backoff so the next call probes immediately. */
export async function probeNow(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(providerHealth)
    .set({ retryAfter: now, updatedAt: now })
    .where(eq(providerHealth.provider, provider));

  invalidate();
}
```

- [ ] **Step 2: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/provider-health.service.ts
git commit -m "feat: add provider health service

A provider past its retry_after is deliberately absent from the down set:
that is the probe. Resolution stops substituting, the next real call tries
the provider, and the outcome updates the row."
```

---

### Task 9: Health-aware tier resolution in ai.service

**Files:**
- Modify: `apps/api/src/services/ai.service.ts:58-79` (`pickModelKey`, `resolveTier`)

- [ ] **Step 1: Add the imports**

In `apps/api/src/services/ai.service.ts`, add to the existing import block:

```ts
import { resolveModelKey } from "./model-resolution";
import { downProviders } from "./provider-health.service";
```

and add `type AiProvider` to the existing `@community-os/shared/ai-catalog` import.

- [ ] **Step 2: Replace `pickModelKey`**

Replace the whole of `pickModelKey` (`ai.service.ts:58-66`) with:

```ts
/**
 * The model a tier will use.
 *
 * Read per call rather than bound at import, so a settings change applies to
 * the next message without a redeploy — and pinned for the whole of one
 * `generateText`, so a change can never land between two steps of a tool loop.
 * `getSettings` and the provider-health snapshot are both memoised in-process.
 *
 * "Usable" is two conditions: the model's API key is present, and its provider
 * has not run out of credit. Both fall through the same `TIER_FALLBACK_ORDER`,
 * so a missing key and an empty balance behave identically — the second was
 * added by extending the first rather than sitting beside it.
 *
 * The stored `ai.model.<tier>` setting is never rewritten. While a provider is
 * down the tier merely resolves elsewhere, so recovery restores the admin's
 * original choice with nothing to undo.
 */
async function pickModelKey(tier: AiTier): Promise<AiModelKey> {
  const selected = isConfigurableTier(tier)
    ? (await getSettings())[`ai.model.${tier}`]
    : DEFAULT_TIER_MODELS[tier];

  const down = await downProviders();
  const resolved = resolveModelKey({
    tier,
    selected,
    isUsable: (key) =>
      hasCredentials(key) && !down.has(AI_CATALOG[key].provider),
  });

  if (resolved === null) {
    throw new Error(
      `[ai] no usable model for tier ${tier}: every provider is either ` +
        `unconfigured or out of credit`,
    );
  }

  return resolved;
}
```

- [ ] **Step 3: Replace `resolveTier`**

Replace the whole of `resolveTier` (`ai.service.ts:67-79`) with:

```ts
async function resolveTier(tier: AiTier): Promise<ResolvedTier> {
  const key = await pickModelKey(tier);

  if (isConfigurableTier(tier)) {
    const selected = (await getSettings())[`ai.model.${tier}`];
    if (key !== selected) {
      console.warn(
        `[ai] ${tier} is set to ${selected} but it is unusable ` +
          `(no ${AI_CATALOG[selected].envKey}, or out of credit) — ` +
          `running on ${key}`,
      );
    }
  }

  return { key, def: AI_CATALOG[key], model: modelFor(key) };
}
```

- [ ] **Step 4: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/api && bun test`
Expected: all pass. `currentModelFor` and `unusableTiers` both call `pickModelKey`/`hasCredentials` and are unchanged in signature.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ai.service.ts
git commit -m "feat: route tiers around providers that are out of credit

Resolution-time substitution, not a settings rewrite: the stored
ai.model.<tier> value is untouched, so recovery restores the admin's
original choice with nothing to undo."
```

---

### Task 10: Failover retry in the tracked wrappers

**Files:**
- Modify: `apps/api/src/services/ai.service.ts` (`trackedGenerateText`, `trackedGenerateObject`)

- [ ] **Step 1: Add the imports**

In `apps/api/src/services/ai.service.ts`:

```ts
import { classifyProviderError } from "./ai-provider-errors";
import { markHealthy, markOutOfCredit } from "./provider-health.service";
```

- [ ] **Step 2: Add the failover helper**

Add above `trackedGenerateText`:

```ts
/**
 * Runs one AI call, and on credit exhaustion runs it once more on whatever the
 * tier resolves to after the dead provider is marked down.
 *
 * One retry, not a loop: the second resolution already skips every provider
 * known to be down, so a second credit failure means the substitute is empty
 * too. That is rare enough to fail loudly rather than cascade.
 *
 * A successful call clears any outage on its provider, which is how a probe
 * after the backoff window turns into recovery.
 */
async function withCreditFailover<R>(
  tier: AiTier,
  attempt: (resolved: ResolvedTier) => Promise<R>,
): Promise<R> {
  const first = await resolveTier(tier);

  try {
    const result = await attempt(first);
    await onCallSucceeded(first.def.provider);
    return result;
  } catch (error) {
    if (classifyProviderError(error) !== "out_of_credit") throw error;

    const outage = await markOutOfCredit(first.def.provider);
    console.warn(
      `[ai] ${first.def.provider} is out of credit (failure ` +
        `#${outage.failureCount}, next probe ${outage.retryAfter.toISOString()})`,
    );

    if (outage.firstTransition) notifyOutage(first.def.provider, tier);

    const second = await resolveTier(tier);
    if (second.key === first.key) throw error;

    console.warn(`[ai] retrying ${tier} on ${second.key}`);
    const result = await attempt(second);
    await onCallSucceeded(second.def.provider);
    return result;
  }
}

/** Recovery bookkeeping, plus the one DM that says a provider is back. */
async function onCallSucceeded(provider: AiProvider): Promise<void> {
  const recovered = await markHealthy(provider).catch((err) => {
    console.error("[ai] markHealthy failed:", err);
    return false;
  });
  if (!recovered) return;

  // Dynamic import keeps the service layer free of a static bot dependency,
  // matching the spend-alert call in assertWithinBudget.
  import("../bot/lib/provider-alert")
    .then((m) => m.notifyAdminsOfProviderRecovery(provider))
    .catch((err) => console.error("[ai] recovery alert failed:", err));
}

/** Fire-and-forget: a failed DM must never block a member's answer. */
function notifyOutage(provider: AiProvider, tier: AiTier): void {
  import("../bot/lib/provider-alert")
    .then((m) => m.notifyAdminsOfProviderOutage(provider, tier))
    .catch((err) => console.error("[ai] outage alert failed:", err));
}
```

- [ ] **Step 3: Rewrite `trackedGenerateText` to run through the helper**

Replace the body of `trackedGenerateText` with:

```ts
async function trackedGenerateText(
  params: Omit<Parameters<typeof generateText>[0], "model">,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  await assertWithinBudget(ctx);

  return withCreditFailover(ctx.tier, async ({ key: modelId, def, model }) => {
    const start = performance.now();

    try {
      // The caller's own providerOptions land second, so an explicit setting
      // still wins over the catalog's default fragment.
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
        withPromptCaching({ ...withReasoning, model } as TextParams, def),
      );
      const durationMs = Math.round(performance.now() - start);
      const { cacheReadTokens, cacheWriteTokens } = cacheSplit(result.usage);

      recordSpend(
        modelId,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
      );

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: true,
        durationMs,
      }).catch((err) => console.error("[ai-usage] tracking failed:", err));

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: 0,
        outputTokens: 0,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      }).catch((err) => console.error("[ai-usage] tracking failed:", err));

      throw error;
    }
  });
}
```

Both attempts therefore write an `ai_usage` row — the first with
`success: false` and the provider's own error text — so an outage is visible in
usage history rather than only in the logs.

- [ ] **Step 4: Rewrite `trackedGenerateObject` the same way**

Replace the body of `trackedGenerateObject` with:

```ts
async function trackedGenerateObject<
  T extends Omit<Parameters<typeof generateObject>[0], "model">,
>(
  params: T,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateObject>>> {
  await assertWithinBudget(ctx);

  return withCreditFailover(ctx.tier, async ({ key: modelId, model }) => {
    const start = performance.now();

    try {
      // Deliberately not cached: a structured-output call is one-shot by
      // construction, so a cache write here could never be read back.
      const result = await generateObject({ ...params, model } as ObjectParams);
      const durationMs = Math.round(performance.now() - start);
      const { cacheReadTokens, cacheWriteTokens } = cacheSplit(result.usage);

      recordSpend(
        modelId,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
      );

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: true,
        durationMs,
      }).catch((err) => console.error("[ai-usage] tracking failed:", err));

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: 0,
        outputTokens: 0,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      }).catch((err) => console.error("[ai-usage] tracking failed:", err));

      throw error;
    }
  });
}
```

- [ ] **Step 5: Type-check**

Run: `bun run --cwd apps/api type-check`
Expected: no output. It will fail until Task 11 creates `bot/lib/provider-alert.ts`; if so, continue to Task 11 and re-run there.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ai.service.ts
git commit -m "feat: retry an AI call on a working model when credit runs out

One retry, not a chain walk: the second resolution already skips every
provider known to be down, so a second credit failure means the
substitute is empty too. Both attempts are recorded in ai_usage."
```

---

### Task 11: Admin notification and the retry-now button

**Files:**
- Create: `apps/api/src/bot/lib/provider-alert.ts`
- Modify: `packages/shared/src/constants.ts:158-169` (`AUDIT_ENTITY_TYPES`)
- Modify: `apps/api/src/bot/handlers/settings.ts` (new callback)

- [ ] **Step 1: Add the audit entity type**

In `packages/shared/src/constants.ts`, add to `AUDIT_ENTITY_TYPES` after `"bot_setting"`:

```ts
  "ai_provider",
```

- [ ] **Step 2: Write the alert module**

Create `apps/api/src/bot/lib/provider-alert.ts`:

```ts
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
    keyboard.text(`Choose model for ${tier}`, `set:view:ai.model.${tier}`).row();
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
  }).catch((err) =>
    console.error("[provider-alert] audit entry failed:", err),
  );
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
  }).catch((err) =>
    console.error("[provider-alert] audit entry failed:", err),
  );
}
```

- [ ] **Step 3: Add the retry-now callback**

In `apps/api/src/bot/handlers/settings.ts`, add the import:

```ts
import { AI_PROVIDERS, type AiProvider } from "@community-os/shared/ai-catalog";
import { probeNow } from "../../services/provider-health.service";
```

and append this handler at the end of the file:

```ts
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
  await ctx.answerCallbackQuery({
    text: "Will retry on the next call.",
  });
});
```

- [ ] **Step 4: Type-check both packages**

Run: `bun run --cwd packages/shared type-check && bun run --cwd apps/api type-check`
Expected: no output from either.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/api && bun test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/constants.ts apps/api/src/bot/lib/provider-alert.ts apps/api/src/bot/handlers/settings.ts
git commit -m "feat: DM admins when a provider runs out of credit

Two messages per outage, however long it lasts: one on the transition,
one on recovery. Failed probes in between are silent. The tier buttons
reuse the settings menu's own set:view callback rather than adding a
second model picker to keep in sync with the catalog."
```

---

### Task 12: End-to-end verification against staging

**Files:** none — this is a manual verification pass.

`apps/api/.env` points at the staging Neon database and a test bot, so this is
safe to run locally.

- [ ] **Step 1: Apply the migration to staging**

Run: `bun db:migrate`
Expected: the `provider_health` migration applies. (Production applies it on
deploy via the Railway config.)

- [ ] **Step 2: Start the API**

Run: `bun run --cwd apps/api dev`
Expected: `Bot @<username> initialized`, no `[ai]` warnings if all keys are set.

- [ ] **Step 3: Force an outage**

Stop the server, set a deliberately invalid `DEEPSEEK_API_KEY` in
`apps/api/.env`, point `smart` at DeepSeek from `/settings → Behaviour`, restart,
and ask the bot something that uses the `smart` tier.

Expected: the member gets a normal answer. Logs show
`[ai] deepseek is out of credit`, then `[ai] retrying smart on anthropic/sonnet-5`.

Note: an invalid key yields a 401, which classifies as `other` and does NOT trip
failover — that is correct behaviour. To exercise the credit path specifically,
either use a genuinely exhausted key, or temporarily add a `throw` of a
handcrafted `APICallError` with status 402 and body `{"error":{"message":
"Insufficient Balance"}}` in `trackedGenerateText`, and remove it after.

- [ ] **Step 4: Confirm the admin DM**

Expected: one DM to each admin naming DeepSeek and the affected tiers, with a
"Choose model for smart" button and "I topped up — retry now".

- [ ] **Step 5: Confirm the setting was not rewritten**

Run `/settings → Behaviour → smart model`.
Expected: it still reads the DeepSeek model. The substitution is resolution-time
only.

- [ ] **Step 6: Confirm the DB state**

Run: `psql "$DATABASE_URL" -c "select * from provider_health;"`
Expected: one `deepseek` row, `state = out_of_credit`, `failure_count = 1`,
`retry_after` ≈ 30 minutes ahead, `notified_at` set.

- [ ] **Step 7: Confirm recovery**

Restore the working key, tap "I topped up — retry now", and ask the bot something
on the `smart` tier.
Expected: the call runs on the DeepSeek model again, one recovery DM arrives, and
the row returns to `state = healthy`, `failure_count = 0`.

- [ ] **Step 8: Confirm no repeat DMs**

With the bad key restored, trigger three more failures.
Expected: exactly one outage DM total, not three. `failure_count` climbs and
`retry_after` steps out to 1h then 2h.

- [ ] **Step 9: Restore the environment**

Put the real `DEEPSEEK_API_KEY` back, reset the `smart` tier to its original
model, and delete any test rows:

```bash
psql "$DATABASE_URL" -c "delete from provider_health;"
```

---

## Post-implementation

- [ ] Run `cd apps/api && bun test` and `cd packages/shared && bun test` — all green.
- [ ] Run `bun run --cwd apps/api type-check` and `bun run --cwd packages/shared type-check` — clean.
- [ ] Set `OPENAI_API_KEY` on the Railway service (a project-scoped `sk-proj-…`
      service-account key). Without it the OpenAI models are filtered out of
      every fallback chain and the feature silently degrades to two providers.
- [ ] Set a project spend limit on the OpenAI project, so "out of credit" fires
      at a chosen boundary rather than after the whole org balance drains.
- [ ] Open a PR from the feature branch into `dev`.
