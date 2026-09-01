import { describe, expect, test } from "bun:test";
import {
  AI_CATALOG,
  AI_MODEL_KEYS,
  AI_TIERS,
  DEFAULT_TIER_MODELS,
  TIER_FALLBACK_ORDER,
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
      expect(AI_CATALOG[key].label.length, `${key} label`).toBeLessThanOrEqual(
        20,
      );
    }
  });
});

describe("modelKeysForTier", () => {
  test("every tier has at least one selectable model", () => {
    for (const tier of AI_TIERS) {
      expect(modelKeysForTier(tier).length, `${tier}`).toBeGreaterThan(0);
    }
  });

  // Any model may be set for any tier — there is deliberately no capability
  // gate in this table. Picking a model that suits the tier is a human call.
  test("every tier offers the whole catalog", () => {
    for (const tier of AI_TIERS) {
      expect(modelKeysForTier(tier), tier).toEqual([...AI_MODEL_KEYS]);
    }
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
      expect(
        [...ranks].sort((a, b) => a - b),
        tier,
      ).toEqual(ranks);
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
