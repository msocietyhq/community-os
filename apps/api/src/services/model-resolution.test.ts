import { describe, expect, test } from "bun:test";
import {
  AI_CATALOG,
  type AiModelKey,
  type AiProvider,
  type AiTier,
} from "@community-os/shared/ai-catalog";
import { resolveModelKey, tiersSelecting } from "./model-resolution";

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
