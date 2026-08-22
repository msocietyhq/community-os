import { describe, expect, test } from "bun:test";
import { BOT_SETTINGS, SETTING_KEYS } from "@community-os/shared/bot-settings";
import { buildSnapshot } from "./bot-settings.service";

describe("buildSnapshot", () => {
  test("returns every registry default when there are no rows", () => {
    const snapshot = buildSnapshot([]);
    for (const key of SETTING_KEYS) {
      expect(snapshot[key]).toEqual(BOT_SETTINGS[key].default);
    }
  });

  test("an override replaces the default", () => {
    const snapshot = buildSnapshot([{ key: "chimeIn.enabled", value: false }]);
    expect(snapshot["chimeIn.enabled"]).toBe(false);
    expect(snapshot["chimeIn.cooldownMinutes"]).toBe(30);
  });

  test("a jsonb date round-trips back into a Date", () => {
    const snapshot = buildSnapshot([
      {
        key: "ai.replies",
        value: { state: "paused_until", until: "2026-08-22T13:00:00.000Z" },
      },
    ]);
    const value = snapshot["ai.replies"];
    expect(value.state).toBe("paused_until");
    if (value.state === "paused_until") {
      expect(value.until).toBeInstanceOf(Date);
    }
  });

  // A row left behind by a removed or retyped setting must never crash the bot.
  test("a corrupt value falls back to the default", () => {
    const snapshot = buildSnapshot([
      { key: "chimeIn.minConfidence", value: "not a number" },
    ]);
    expect(snapshot["chimeIn.minConfidence"]).toBe(0.8);
  });

  test("an unknown key is ignored", () => {
    const snapshot = buildSnapshot([{ key: "nope.gone", value: 1 }]);
    expect(Object.keys(snapshot).sort()).toEqual([...SETTING_KEYS].sort());
  });
});
