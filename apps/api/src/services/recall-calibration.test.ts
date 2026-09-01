import { describe, expect, test } from "bun:test";
import {
  deriveFloor,
  needsCalibration,
  FALLBACK_SIMILARITY_FLOOR,
  CALIBRATION_TTL_MS,
  FLOOR_MIN,
  FLOOR_MAX,
  type NoiseProfile,
} from "./recall-calibration";

const profile = (p90: number, measuredAt = 0): NoiseProfile => ({
  pairsCompared: 19900,
  mean: 0.35,
  p50: 0.348,
  p90,
  p99: 0.612,
  measuredAt,
});

describe("deriveFloor", () => {
  test("uses the measured noise p90", () => {
    expect(deriveFloor(profile(0.476))).toBe(0.476);
  });

  test("falls back when nothing has been measured", () => {
    expect(deriveFloor(null)).toBe(FALLBACK_SIMILARITY_FLOOR);
  });

  /** A pathological measurement must degrade to a known-good default. */
  test.each([
    ["too low — would let everything through", FLOOR_MIN - 0.01],
    ["too high — would disable recall", FLOOR_MAX + 0.01],
    ["zero", 0],
    ["one", 1],
  ])("clamps %s", (_label, p90) => {
    expect(deriveFloor(profile(p90))).toBe(FALLBACK_SIMILARITY_FLOOR);
  });

  test("clamp boundaries are inclusive", () => {
    expect(deriveFloor(profile(FLOOR_MIN))).toBe(FLOOR_MIN);
    expect(deriveFloor(profile(FLOOR_MAX))).toBe(FLOOR_MAX);
  });

  test("NaN falls back rather than poisoning every comparison", () => {
    expect(deriveFloor(profile(Number.NaN))).toBe(FALLBACK_SIMILARITY_FLOOR);
    expect(deriveFloor(profile(Number.POSITIVE_INFINITY))).toBe(
      FALLBACK_SIMILARITY_FLOOR,
    );
  });

  test("an explicit fallback is honoured", () => {
    expect(deriveFloor(null, 0.6)).toBe(0.6);
  });

  /**
   * The measured production numbers: noise p90 0.476 sits below true-match
   * p10 0.575, so the floor lands in the gap rather than cutting real recalls.
   */
  test("the production measurement lands between noise and signal", () => {
    const floor = deriveFloor(profile(0.476));
    expect(floor).toBeGreaterThan(0.345); // noise mean
    expect(floor).toBeLessThan(0.575); // weakest true match
  });
});

describe("needsCalibration", () => {
  const now = 1_800_000_000_000;

  test("no profile means calibrate", () => {
    expect(needsCalibration(null, now)).toBe(true);
  });

  test("a fresh profile is left alone", () => {
    expect(needsCalibration(profile(0.47, now - 1000), now)).toBe(false);
  });

  test("a stale profile triggers a refresh", () => {
    expect(
      needsCalibration(profile(0.47, now - CALIBRATION_TTL_MS - 1), now),
    ).toBe(true);
  });

  test("exactly at the TTL refreshes", () => {
    expect(needsCalibration(profile(0.47, now - CALIBRATION_TTL_MS), now)).toBe(
      true,
    );
  });

  test("the TTL is configurable", () => {
    expect(needsCalibration(profile(0.47, now - 50), now, 10)).toBe(true);
    expect(needsCalibration(profile(0.47, now - 5), now, 10)).toBe(false);
  });
});
