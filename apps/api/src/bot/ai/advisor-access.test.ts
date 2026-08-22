import { describe, expect, test } from "bun:test";
import {
  decideAccess,
  startOfDayUtc,
  activeSince,
  ADVISOR_DAILY_BUDGET_USD,
  ACTIVE_WINDOW_DAYS,
  type AdvisorDenied,
} from "./advisor-access";

const denied = (r: ReturnType<typeof decideAccess>) => r as AdvisorDenied;

const base = {
  telegramId: 42 as number | null,
  isRecentlyActive: true,
  spentTodayUsd: 0,
};

describe("decideAccess", () => {
  test("an active member under budget gets both tiers", () => {
    expect(decideAccess({ ...base, tier: "big" }).allowed).toBe(true);
    expect(decideAccess({ ...base, tier: "bigger" }).allowed).toBe(true);
  });

  test("the cheap tier is not activity-gated", () => {
    const result = decideAccess({ ...base, tier: "big", isRecentlyActive: false });
    expect(result.allowed).toBe(true);
  });

  test("the deep tier requires recent activity", () => {
    const result = decideAccess({ ...base, tier: "bigger", isRecentlyActive: false });
    expect(result.allowed).toBe(false);
    expect(denied(result).reason).toBe("inactive");
  });

  test("budget applies to both tiers", () => {
    for (const tier of ["big", "bigger"] as const) {
      const result = decideAccess({ ...base, tier, spentTodayUsd: ADVISOR_DAILY_BUDGET_USD });
      expect(result.allowed).toBe(false);
      expect(denied(result).reason).toBe("budget");
    }
  });

  test("budget is checked before activity, so the message names the real blocker", () => {
    const result = decideAccess({
      ...base,
      tier: "bigger",
      isRecentlyActive: false,
      spentTodayUsd: 1,
    });
    expect(denied(result).reason).toBe("budget");
  });

  test("spending just under the cap still passes", () => {
    const result = decideAccess({
      ...base,
      tier: "bigger",
      spentTodayUsd: ADVISOR_DAILY_BUDGET_USD - 0.001,
    });
    expect(result.allowed).toBe(true);
  });

  test("an unidentifiable sender is refused", () => {
    const result = decideAccess({ ...base, tier: "big", telegramId: null });
    expect(denied(result).reason).toBe("unknown_sender");
  });

  // ── the friendly part ────────────────────────────────────────────────────

  /** A silent refusal reads as a bug; every denial explains itself. */
  test("every denial carries text the agent can relay", () => {
    const cases = [
      decideAccess({ ...base, tier: "big", telegramId: null }),
      decideAccess({ ...base, tier: "bigger", isRecentlyActive: false }),
      decideAccess({ ...base, tier: "big", spentTodayUsd: 5 }),
    ];
    for (const result of cases) {
      const message = denied(result).tellUser;
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain("error");
      expect(message).not.toContain("denied");
    }
  });

  test("the budget message says when it resets", () => {
    const message = denied(decideAccess({ ...base, tier: "big", spentTodayUsd: 5 })).tellUser;
    expect(message).toContain("midnight UTC");
  });

  test("the inactivity message says how to fix it", () => {
    const message = denied(
      decideAccess({ ...base, tier: "bigger", isRecentlyActive: false }),
    ).tellUser;
    expect(message).toContain(String(ACTIVE_WINDOW_DAYS));
    expect(message).toContain("say salam in the group");
  });

  test("denials still promise a best-effort answer rather than stopping", () => {
    const message = denied(decideAccess({ ...base, tier: "big", spentTodayUsd: 5 })).tellUser;
    expect(message.toLowerCase()).toContain("i'll");
  });
});

describe("time windows", () => {
  test("the budget day starts at midnight UTC", () => {
    const start = startOfDayUtc(new Date("2026-08-20T21:59:00Z"));
    expect(start.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("startOfDayUtc is idempotent", () => {
    const midnight = new Date("2026-08-20T00:00:00.000Z");
    expect(startOfDayUtc(midnight).toISOString()).toBe(midnight.toISOString());
  });

  test("the activity window looks back the configured number of days", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const since = activeSince(now);
    const days = (now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(ACTIVE_WINDOW_DAYS);
  });
});

describe("configurable tier limit", () => {
  const base = {
    telegramId: 1,
    isRecentlyActive: true,
    spentTodayUsd: 0,
  };

  test("maxTier off denies every tier", () => {
    const result = decideAccess({ ...base, tier: "big", maxTier: "off" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("tier_disabled");
  });

  test("maxTier big denies the deeper tier but allows the cheaper one", () => {
    expect(
      decideAccess({ ...base, tier: "bigger", maxTier: "big" }).allowed,
    ).toBe(false);
    expect(decideAccess({ ...base, tier: "big", maxTier: "big" }).allowed).toBe(
      true,
    );
  });

  test("tier_disabled is reported before the budget, so the message is honest", () => {
    const result = decideAccess({
      ...base,
      tier: "big",
      maxTier: "off",
      spentTodayUsd: 999,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("tier_disabled");
  });

  test("a configured budget overrides the default", () => {
    expect(
      decideAccess({ ...base, tier: "big", spentTodayUsd: 0.6 }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        ...base,
        tier: "big",
        spentTodayUsd: 0.6,
        dailyBudgetUsd: 2,
      }).allowed,
    ).toBe(true);
  });
});
