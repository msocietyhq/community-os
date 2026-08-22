import { describe, expect, test } from "bun:test";
import {
  DRAFT_TTL_MS,
  detectDrift,
  dropChange,
  invert,
  isDraftExpired,
  type SettingsDraft,
} from "./settings-draft";

const draft = (): SettingsDraft => ({
  changes: [
    { key: "chimeIn.enabled", from: true, to: false },
    { key: "chimeIn.cooldownMinutes", from: 30, to: 60 },
    { key: "cost.dailyCapUsd", from: 10, to: 4 },
  ],
  createdAt: 1_000,
  messageId: 42,
});

describe("isDraftExpired", () => {
  test("a fresh draft is live", () => {
    expect(isDraftExpired(draft(), 1_000 + DRAFT_TTL_MS - 1)).toBe(false);
  });

  test("expires exactly at the TTL", () => {
    expect(isDraftExpired(draft(), 1_000 + DRAFT_TTL_MS)).toBe(true);
  });
});

describe("dropChange", () => {
  test("removes the change at the index", () => {
    const result = dropChange(draft(), 1);
    expect(result.changes.map((c) => c.key)).toEqual([
      "chimeIn.enabled",
      "cost.dailyCapUsd",
    ]);
  });

  test("does not mutate the original", () => {
    const original = draft();
    dropChange(original, 0);
    expect(original.changes).toHaveLength(3);
  });

  test("an out-of-range index is a no-op", () => {
    expect(dropChange(draft(), 9).changes).toHaveLength(3);
  });
});

describe("detectDrift", () => {
  test("no drift when current matches every recorded from", () => {
    const current = {
      "chimeIn.enabled": true,
      "chimeIn.cooldownMinutes": 30,
      "cost.dailyCapUsd": 10,
    };
    expect(detectDrift(draft(), current)).toEqual([]);
  });

  test("reports a key changed since the draft was made", () => {
    const current = {
      "chimeIn.enabled": true,
      "chimeIn.cooldownMinutes": 45,
      "cost.dailyCapUsd": 10,
    };
    const drifted = detectDrift(draft(), current);
    expect(drifted).toHaveLength(1);
    expect(drifted[0]?.key).toBe("chimeIn.cooldownMinutes");
    expect(drifted[0]?.current).toBe(45);
  });

  test("compares object values structurally, not by reference", () => {
    const d: SettingsDraft = {
      changes: [
        {
          key: "availability.quietHours",
          from: { start: "23:00", end: "07:00" },
          to: null,
        },
      ],
      createdAt: 0,
      messageId: 1,
    };
    const current = {
      "availability.quietHours": { start: "23:00", end: "07:00" },
    };
    expect(detectDrift(d, current)).toEqual([]);
  });
});

describe("invert", () => {
  test("swaps from and to on every change", () => {
    expect(invert(draft().changes)).toEqual([
      { key: "chimeIn.enabled", from: false, to: true },
      { key: "chimeIn.cooldownMinutes", from: 60, to: 30 },
      { key: "cost.dailyCapUsd", from: 4, to: 10 },
    ]);
  });
});
