import { describe, expect, test } from "bun:test";
import { decideBudget } from "./ai-budget";

const base = {
  callClass: "interactive" as const,
  backgroundPaused: false,
  spentTodayUsd: 0,
  spentMonthUsd: 0,
  dailyCapUsd: 10 as number | null,
  monthlyCapUsd: 150 as number | null,
};

describe("decideBudget", () => {
  test("allows a normal interactive call", () => {
    expect(decideBudget(base).allowed).toBe(true);
  });

  test("blocks a background call while background is paused", () => {
    const result = decideBudget({
      ...base,
      callClass: "background",
      backgroundPaused: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("background_paused");
  });

  test("an interactive call is unaffected by the background pause", () => {
    expect(decideBudget({ ...base, backgroundPaused: true }).allowed).toBe(true);
  });

  test("blocks at the daily cap", () => {
    const result = decideBudget({ ...base, spentTodayUsd: 10 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("daily_cap");
  });

  test("allows just under the daily cap", () => {
    expect(decideBudget({ ...base, spentTodayUsd: 9.99 }).allowed).toBe(true);
  });

  test("blocks at the monthly cap even when the day is clear", () => {
    const result = decideBudget({ ...base, spentMonthUsd: 150 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("monthly_cap");
  });

  test("a null cap means unlimited", () => {
    expect(
      decideBudget({
        ...base,
        dailyCapUsd: null,
        monthlyCapUsd: null,
        spentTodayUsd: 9_999,
        spentMonthUsd: 9_999,
      }).allowed,
    ).toBe(true);
  });

  // Caps bind everything. A pause that only stopped members while the crons
  // kept spending would defeat the point of pausing during a cost spike.
  test("caps apply to background calls too", () => {
    expect(
      decideBudget({ ...base, callClass: "background", spentTodayUsd: 10 })
        .allowed,
    ).toBe(false);
  });
});
