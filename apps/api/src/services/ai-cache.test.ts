import { describe, expect, test } from "bun:test";
// Imported from the pure module, not the service: ai.service pulls in the
// database and `env`, which validates at import time and throws when the test
// runner hasn't loaded apps/api/.env.
import { AI_CATALOG } from "@community-os/shared/ai-catalog";
import { cacheSplit, withPromptCaching } from "./ai-cache";

const ANTHROPIC = AI_CATALOG["anthropic/haiku-4-5"];

/** A stand-in for a provider that caches implicitly and takes no flag. */
const IMPLICIT = { ...ANTHROPIC, cacheControl: null };

// The shape the service passes through; only `tools` and `providerOptions`
// affect the decision, so the rest is stubbed.
// biome-ignore lint/suspicious/noExplicitAny: constructing partial SDK params
const params = (extra: Record<string, unknown>) =>
  ({ model: "m", prompt: "p", ...extra }) as any;

const readCacheControl = (result: { providerOptions?: unknown }) => {
  const opts = result.providerOptions as
    | { anthropic?: { cacheControl?: unknown } }
    | undefined;
  return opts?.anthropic?.cacheControl;
};

describe("withPromptCaching", () => {
  test("skips a call with no tools — nothing could ever read the write", () => {
    const input = params({});
    const result = withPromptCaching(input, ANTHROPIC);
    expect(result).toBe(input); // untouched, not merely equivalent
    expect(readCacheControl(result)).toBeUndefined();
  });

  test("skips a call whose tool set is present but empty", () => {
    const result = withPromptCaching(params({ tools: {} }), ANTHROPIC);
    expect(readCacheControl(result)).toBeUndefined();
  });

  test("caches a call that can loop", () => {
    const result = withPromptCaching(
      params({ tools: { search: {} } }),
      ANTHROPIC,
    );
    expect(readCacheControl(result)).toEqual({ type: "ephemeral" });
  });

  test("adds nothing when the model caches implicitly", () => {
    const input = params({ tools: { search: {} } });
    const result = withPromptCaching(input, IMPLICIT);
    expect(result).toBe(input); // untouched, not merely equivalent
    expect(readCacheControl(result)).toBeUndefined();
  });

  test("keeps other provider options when adding the breakpoint", () => {
    const result = withPromptCaching(
      params({
        tools: { search: {} },
        providerOptions: { anthropic: { effort: "high" } },
      }),
      ANTHROPIC,
    );
    const anthropic = (
      result.providerOptions as { anthropic: Record<string, unknown> }
    ).anthropic;
    expect(anthropic.effort).toBe("high");
    expect(anthropic.cacheControl).toEqual({ type: "ephemeral" });
  });

  test("an explicit cacheControl wins over the default", () => {
    const result = withPromptCaching(
      params({
        tools: { search: {} },
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      }),
      ANTHROPIC,
    );
    expect(readCacheControl(result)).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("a caller can opt in on a toolless call by asking directly", () => {
    // The early return must not strip an explicit request.
    const result = withPromptCaching(
      params({
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      }),
      ANTHROPIC,
    );
    expect(readCacheControl(result)).toEqual({ type: "ephemeral" });
  });
});

describe("cacheSplit", () => {
  test("reads both counts from the provider's breakdown", () => {
    expect(
      cacheSplit({
        inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 100 },
      }),
    ).toEqual({ cacheReadTokens: 900, cacheWriteTokens: 100 });
  });

  test("defaults to zero when the provider reports no breakdown", () => {
    expect(cacheSplit({})).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  test("defaults each field independently", () => {
    expect(cacheSplit({ inputTokenDetails: { cacheReadTokens: 42 } })).toEqual({
      cacheReadTokens: 42,
      cacheWriteTokens: 0,
    });
  });
});
