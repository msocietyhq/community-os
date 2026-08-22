import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  SETTING_GROUPS,
  callbackFor,
  isPaused,
  previewText,
  type PauseState,
} from "./bot-settings";

describe("registry invariants", () => {
  test("every default parses against its own schema", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      const result = def.schema.safeParse(def.default);
      expect(result.success, `${key} default failed its schema`).toBe(true);
    }
  });

  test("every setting has a label and a description", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      expect(def.label.length, `${key} label`).toBeGreaterThan(0);
      expect(def.description.length, `${key} description`).toBeGreaterThan(20);
    }
  });

  test("every setting belongs to a known group", () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_GROUPS).toContain(BOT_SETTINGS[key].group);
    }
  });

  // Telegram rejects callback_data over 64 bytes. This is the permanent guard.
  test("every generated callback fits in 64 bytes", () => {
    for (const key of SETTING_KEYS) {
      for (const prefix of ["view", "reset", "undo"]) {
        const data = callbackFor(prefix, key);
        expect(
          Buffer.byteLength(data, "utf8"),
          `${data} is too long`,
        ).toBeLessThanOrEqual(64);
      }
    }
  });

  // Telegram rejects a lone surrogate with "button text must be encoded in
  // UTF-8" and fails the ENTIRE message, not just the offending button. A
  // UTF-8 round-trip replaces invalid sequences with U+FFFD, so inequality
  // detects exactly what Telegram would reject.
  test("no formatted default contains a lone surrogate", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      const format = def.format as (v: unknown) => string;
      const out = format(def.default);
      expect(
        Buffer.from(out, "utf8").toString("utf8"),
        `${key} formats to invalid UTF-8`,
      ).toBe(out);
    }
  });

  test("format never throws on the default value", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      // Each entry's format is typed to its own value; across the key union
      // that collapses to an uncallable intersection, so narrow once here.
      const format = def.format as (v: unknown) => string;
      expect(typeof format(def.default)).toBe("string");
    }
  });
});

describe("isPaused", () => {
  const now = new Date("2026-08-22T12:00:00Z");

  test("active is never paused", () => {
    expect(isPaused({ state: "active" }, now)).toBe(false);
  });

  test("paused is always paused", () => {
    expect(isPaused({ state: "paused" }, now)).toBe(true);
  });

  test("paused_until in the future is paused", () => {
    const s: PauseState = {
      state: "paused_until",
      until: new Date("2026-08-22T13:00:00Z"),
    };
    expect(isPaused(s, now)).toBe(true);
  });

  test("paused_until in the past has expired", () => {
    const s: PauseState = {
      state: "paused_until",
      until: new Date("2026-08-22T11:00:00Z"),
    };
    expect(isPaused(s, now)).toBe(false);
  });
});

describe("previewText", () => {
  test("leaves a short string alone", () => {
    expect(previewText("hello")).toBe("hello");
  });

  test("collapses newlines so a button label stays on one line", () => {
    expect(previewText("a\n\nb   c")).toBe("a b c");
  });

  // The bug this exists for: slice(0, 30) cut U+1F44B in half and Telegram
  // rejected the whole menu page.
  test("never splits a surrogate pair", () => {
    const text = `${"a".repeat(29)}👋 tail`;
    const out = previewText(text);
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
    expect(out.endsWith("…")).toBe(true);
  });

  test("counts by code point, not code unit", () => {
    // 5 emoji = 10 UTF-16 units but 5 code points, so nothing is truncated.
    expect(previewText("👋👋👋👋👋", 5)).toBe("👋👋👋👋👋");
  });

  test("truncates on a boundary when the limit lands mid-emoji", () => {
    const out = previewText("👋👋👋", 2);
    expect(out).toBe("👋👋…");
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });
});
