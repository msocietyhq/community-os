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
