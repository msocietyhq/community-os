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

export const AI_PROVIDERS = ["anthropic", "deepseek", "openai"] as const;
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

/**
 * OpenAI bills a cache read at 0.1x and a write at 1.25x — the Anthropic
 * shape, not DeepSeek's. GPT-5.6+ prices implicit and explicit caching
 * identically and places its own breakpoints, so `cacheControl` stays null.
 */
const OPENAI_CACHE = { read: 0.1, write: 1.25 };

const OPENAI_REASONING = {
  medium: { openai: { reasoningEffort: "medium" } },
  high: { openai: { reasoningEffort: "high" } },
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
  }),
  // DeepSeek prices by time of day: off-peak (01:00–04:00 and 06:00–10:00 UTC,
  // Mon–Fri) is half of peak. The catalog holds one number, so it holds the
  // PEAK rate. Off-peak calls are then over-counted about 2x, which makes the
  // spend caps bind early — the safe direction. Recording off-peak would let
  // real spend run to double the cap without it ever tripping.
  //
  // Caching is automatic and there is no write surcharge, so `write` is 1 and
  // `cacheControl` is null — the hit/miss ratio is where the discount lives.
  "deepseek/v4-flash": model({
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    pricing: { input: 0.44, output: 1.32 },
    cache: { read: 0.032, write: 1 },
    cacheControl: null,
    reasoning: null,
    envKey: "DEEPSEEK_API_KEY",
  }),
  "deepseek/v4-pro": model({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    pricing: { input: 1.32, output: 3.96 },
    cache: { read: 0.033, write: 1 },
    cacheControl: null,
    reasoning: null,
    envKey: "DEEPSEEK_API_KEY",
  }),
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

/**
 * Tiers whose model can be changed at runtime. Everything else is pinned in
 * code and has no settings entry.
 *
 * `micro` is pinned deliberately. It is entirely `generateObject`, and
 * structured output is the least portable thing across providers — DeepSeek,
 * for one, has no native JSON-schema mode, so the AI SDK falls back to pasting
 * the schema into the system prompt and hoping. That turns a provider
 * guarantee into a request, on the highest-volume path in the system, where
 * failures are silent: the chime-in judge resolves errors to silence and the
 * memory extractor logs and moves on. Not a knob worth exposing.
 */
export const CONFIGURABLE_TIERS = ["fast", "smart", "deep"] as const;
export type ConfigurableTier = (typeof CONFIGURABLE_TIERS)[number];

export function isConfigurableTier(tier: AiTier): tier is ConfigurableTier {
  return (CONFIGURABLE_TIERS as readonly AiTier[]).includes(tier);
}

/**
 * Which models may be selected for a tier: every model, for every tier.
 *
 * Kept as a function rather than inlining `AI_MODEL_KEYS` at the call sites so
 * a per-tier restriction has one place to live if one is ever wanted. It
 * previously filtered `fast`/`smart`/`deep` down to models vetted for the
 * ten-step agent loop; that gate was removed deliberately — capability is a
 * judgement for whoever picks the model, not something this table asserts.
 */
export function modelKeysForTier(_tier: AiTier): [AiModelKey, ...AiModelKey[]] {
  return [...AI_MODEL_KEYS] as [AiModelKey, ...AiModelKey[]];
}

/** The tier defaults. Exact parity with the previous hardcoded AI_MODEL_IDS. */
export const DEFAULT_TIER_MODELS: Record<AiTier, AiModelKey> = {
  micro: "anthropic/haiku-4-5",
  fast: "anthropic/haiku-4-5",
  smart: "anthropic/sonnet-5",
  deep: "anthropic/opus-5",
};

/**
 * What a tier runs on when its selected model cannot be used — because the
 * provider has no API key, or has run out of prepaid credit.
 *
 * Read in order, first usable entry wins. The first entry is always
 * `DEFAULT_TIER_MODELS[tier]`, so the ordinary single-outage case is simply
 * "fall back to the tier default"; the rest of the row only matters when that
 * provider is down too. Providers appear in the fixed preference order
 * anthropic -> openai -> deepseek.
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
