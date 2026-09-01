import { describe, expect, test } from "bun:test";
import { parseEditValue } from "./settings-parse";

const now = new Date("2026-08-22T12:00:00Z");

describe("parseEditValue", () => {
  test("pause presets become the right state", () => {
    expect(parseEditValue("ai.replies", "inf", now)).toEqual({
      ok: true,
      value: { state: "paused" },
    });
    expect(parseEditValue("ai.replies", "0", now)).toEqual({
      ok: true,
      value: { state: "active" },
    });
  });

  test("a pause duration becomes an absolute expiry", () => {
    const result = parseEditValue("ai.replies", "60", now);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.state === "paused_until") {
      expect(result.value.until.toISOString()).toBe("2026-08-22T13:00:00.000Z");
    }
  });

  test("toggles read as booleans", () => {
    expect(parseEditValue("chimeIn.enabled", "false", now)).toEqual({
      ok: true,
      value: false,
    });
    expect(parseEditValue("chimeIn.enabled", "true", now)).toEqual({
      ok: true,
      value: true,
    });
  });

  test("'none' means unlimited on a nullable cap", () => {
    expect(parseEditValue("cost.dailyCapUsd", "none", now)).toEqual({
      ok: true,
      value: null,
    });
  });

  test("quiet hours parse into a window, and 'off' into null", () => {
    expect(
      parseEditValue("availability.quietHours", "23:00-07:00", now),
    ).toEqual({ ok: true, value: { start: "23:00", end: "07:00" } });
    expect(parseEditValue("availability.quietHours", "off", now)).toEqual({
      ok: true,
      value: null,
    });
  });

  // A stale button from before a deploy, or a hand-crafted callback, must fail
  // here rather than writing nonsense into the settings table.
  test("a non-numeric value is rejected, not coerced", () => {
    expect(parseEditValue("cost.dailyCapUsd", "abc", now).ok).toBe(false);
  });

  test("a value outside the schema's range is rejected", () => {
    expect(parseEditValue("chimeIn.minConfidence", "5", now).ok).toBe(false);
    expect(parseEditValue("cost.dailyCapUsd", "-1", now).ok).toBe(false);
  });

  test("an unknown enum member is rejected", () => {
    expect(parseEditValue("dm.access", "everybody", now).ok).toBe(false);
    expect(parseEditValue("cost.advisorMaxTier", "biggest", now).ok).toBe(
      false,
    );
  });

  test("a malformed quiet-hours window is rejected", () => {
    expect(
      parseEditValue("availability.quietHours", "25:00-07:00", now).ok,
    ).toBe(false);
    expect(parseEditValue("availability.quietHours", "nonsense", now).ok).toBe(
      false,
    );
  });
});
