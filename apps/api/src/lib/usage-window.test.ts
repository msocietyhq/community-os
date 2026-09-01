import { describe, expect, test } from "bun:test";
import { resolveWindow, DEFAULT_WINDOW } from "./usage-window";

const NOW = new Date("2026-08-21T14:30:00Z");
const daysBack = (w: ReturnType<typeof resolveWindow>) =>
  (NOW.getTime() - w.since.getTime()) / (24 * 60 * 60 * 1000);

describe("resolveWindow", () => {
  test.each([
    ["7d", 7],
    ["30d", 30],
    ["1d", 1],
    ["2w", 14],
    ["1w", 7],
  ])("%s resolves to %i days back", (spec, days) => {
    expect(daysBack(resolveWindow(spec, NOW))).toBe(days);
  });

  test("bare numbers are read as days", () => {
    expect(daysBack(resolveWindow("14", NOW))).toBe(14);
  });

  test("spelled-out units work", () => {
    expect(daysBack(resolveWindow("3 weeks", NOW))).toBe(21);
    expect(daysBack(resolveWindow("5 days", NOW))).toBe(5);
  });

  test("months step by calendar month, not 30 days", () => {
    expect(resolveWindow("3m", NOW).since.toISOString()).toBe(
      "2026-05-21T14:30:00.000Z",
    );
  });

  test("years step by calendar year", () => {
    expect(resolveWindow("1y", NOW).since.toISOString()).toBe(
      "2025-08-21T14:30:00.000Z",
    );
  });

  test("today starts at midnight UTC, not 24 hours ago", () => {
    expect(resolveWindow("today", NOW).since.toISOString()).toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });

  test("ytd starts on 1 January", () => {
    expect(resolveWindow("ytd", NOW).since.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("all time reaches the epoch", () => {
    expect(resolveWindow("all", NOW).since.getTime()).toBe(0);
  });

  test("word forms a member might type are understood", () => {
    expect(daysBack(resolveWindow("last week", NOW))).toBe(7);
    expect(daysBack(resolveWindow("this month", NOW))).toBe(30);
    expect(resolveWindow("this year", NOW).label).toBe("year to date");
  });

  test("case and surrounding space are ignored", () => {
    expect(daysBack(resolveWindow("  7D  ", NOW))).toBe(7);
    expect(resolveWindow("  ALL ", NOW).since.getTime()).toBe(0);
  });

  // ── never fail the tool call ─────────────────────────────────────────────

  test("undefined uses the default window", () => {
    expect(daysBack(resolveWindow(undefined, NOW))).toBe(
      Number(DEFAULT_WINDOW.replace("d", "")),
    );
  });

  test.each(["", "nonsense", "0d", "-5d", "last fortnight", "🙂"])(
    "unrecognised input %p falls back rather than throwing",
    (spec) => {
      const w = resolveWindow(spec, NOW);
      expect(daysBack(w)).toBe(30);
      expect(w.since.getTime()).toBeLessThan(NOW.getTime());
    },
  );

  test("the fallback says it wasn't understood, so the agent can admit it", () => {
    expect(resolveWindow("last fortnight", NOW).label).toContain(
      "unrecognised",
    );
  });

  /** The label is reported back, so it must describe what was measured. */
  test("labels are singular or plural correctly", () => {
    expect(resolveWindow("1d", NOW).label).toBe("the last 1 day");
    expect(resolveWindow("2d", NOW).label).toBe("the last 2 days");
    expect(resolveWindow("1m", NOW).label).toBe("the last 1 month");
  });
});
