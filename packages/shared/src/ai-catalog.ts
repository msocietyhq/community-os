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

export const AI_PROVIDERS = ["anthropic", "deepseek"] as const;
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
    // Not yet vetted against the ten-step agent loop. Keeping this false
    // confines it to `micro`, where no tool is ever passed.
    toolLoop: false,
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
    toolLoop: false,
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
