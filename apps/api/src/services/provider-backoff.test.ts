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
