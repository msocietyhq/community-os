import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  SETTING_GROUPS,
  EDITABLE_SETTING_KEYS,
  callbackFor,
  isPaused,
  isEditableSetting,
  keysInGroup,
  previewText,
  type PauseState,
  type SettingKey,
  optionsFor,
  publicSettingValue,
} from "./bot-settings";
import {
  AI_TIERS,
  CONFIGURABLE_TIERS,
  DEFAULT_TIER_MODELS,
  isConfigurableTier,
  modelKeysForTier,
} from "./ai-catalog";

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
      for (const prefix of ["view", "reset", "undo", "regen", "regenok"]) {
        const data = callbackFor(prefix, key);
        expect(
          Buffer.byteLength(data, "utf8"),
          `${data} is too long`,
        ).toBeLessThanOrEqual(64);
      }
    }
  });

  test("the computer group exposes the public key and hides the private key", () => {
    const keys = keysInGroup("computer");
    expect(keys).toContain("computer.sshPublicKey");
    expect(keys).not.toContain("computer.sshPrivateKey");
    expect(BOT_SETTINGS["computer.sshPrivateKey"].hidden).toBe(true);
    expect(BOT_SETTINGS["computer.sshPrivateKey"].secret).toBe(true);
    expect(BOT_SETTINGS["computer.sshPublicKey"].readonly).toBe(true);
    expect(BOT_SETTINGS["computer.sshPublicKey"].regenerable).toBe(true);
    expect(isEditableSetting("computer.sshPrivateKey")).toBe(false);
    expect(isEditableSetting("computer.sshPublicKey")).toBe(false);
    expect(isEditableSetting("computer.sshHost")).toBe(true);
    expect(EDITABLE_SETTING_KEYS).not.toContain("computer.sshPrivateKey");
    expect(EDITABLE_SETTING_KEYS).not.toContain("computer.sshPublicKey");
    expect(EDITABLE_SETTING_KEYS).toContain("computer.sshHost");
  });

  test("the computer sub-agent has its own model setting", () => {
    expect(keysInGroup("computer")).toContain("ai.model.computer");
    expect(keysInGroup("cost")).not.toContain("ai.model.computer");
    expect(BOT_SETTINGS["ai.model.computer"].group).toBe("computer");
    expect(BOT_SETTINGS["ai.model.computer"].control).toBe("choice");
    expect(BOT_SETTINGS["ai.model.computer"].label).toBe("Model");
    expect(BOT_SETTINGS["ai.model.computer"].default).toBe(
      DEFAULT_TIER_MODELS.computer,
    );
    expect(isEditableSetting("ai.model.computer")).toBe(true);
    expect(EDITABLE_SETTING_KEYS).toContain("ai.model.computer");
  });

  // An edit callback carries the chosen value, so it is much longer than the
  // value-free prefixes above. A model key like "anthropic/haiku-4-5" pushes
  // hardest, and Telegram fails the ENTIRE message if any callback is over 64.
  test("every model option's edit callback fits in 64 bytes", () => {
    for (const tier of CONFIGURABLE_TIERS) {
      const key = `ai.model.${tier}` as SettingKey;
      for (const value of modelKeysForTier(tier)) {
        const data = callbackFor("edit", key, value);
        expect(
          Buffer.byteLength(data, "utf8"),
          `${data} is too long`,
        ).toBeLessThanOrEqual(64);
      }
    }
  });

  // micro is pinned in code — exposing it would put a runtime knob on the
  // highest-volume path, where structured-output support varies by provider
  // and failures are silent.
  test("configurable tiers have a setting; pinned tiers do not", () => {
    const registered: readonly string[] = SETTING_KEYS;
    for (const tier of AI_TIERS) {
      const key = `ai.model.${tier}`;
      if (isConfigurableTier(tier)) {
        expect(registered, key).toContain(key);
      } else {
        expect(registered, key).not.toContain(key);
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

  test("secret settings never format to their contents", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      if (!def.secret) continue;
      const format = def.format as (v: unknown) => string;
      const out = format("-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n");
      expect(out).not.toContain("BEGIN");
      expect(out).not.toContain("secret");
    }
  });

  test("format never throws on the default value", () => {
    for (const key of SETTING_KEYS) {
      const def = BOT_SETTINGS[key];
      const format = def.format as (v: unknown) => string;
      expect(typeof format(def.default)).toBe("string");
    }
  });
});

describe("publicSettingValue", () => {
  test("passes ordinary values through", () => {
    expect(publicSettingValue("chimeIn.enabled", true)).toBe(true);
    expect(publicSettingValue("computer.sshHost", "vm.example")).toBe(
      "vm.example",
    );
  });

  test("never returns a secret's contents", () => {
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-material\n-----END OPENSSH PRIVATE KEY-----";
    expect(publicSettingValue("computer.sshPrivateKey", pem)).toBe("set");
    expect(publicSettingValue("computer.sshPrivateKey", "")).toBe("not set");
    expect(publicSettingValue("computer.sshPrivateKey", pem)).not.toContain(
      "BEGIN",
    );
  });

  test("the public key is shown as-is", () => {
    const pub =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake community-os-computer";
    expect(publicSettingValue("computer.sshPublicKey", pub)).toBe(pub);
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

describe("optionsFor", () => {
  test("lists the models allowed for each configurable tier", () => {
    for (const tier of CONFIGURABLE_TIERS) {
      const key = `ai.model.${tier}` as SettingKey;
      expect(optionsFor(key), key).toEqual([...modelKeysForTier(tier)]);
    }
  });

  test("covers the other enum settings too", () => {
    expect(optionsFor("dm.access")).toEqual(["everyone", "members", "admins"]);
    expect(optionsFor("cost.advisorMaxTier")).toEqual(["off", "big", "bigger"]);
  });

  // quietHours is a `choice` control but its schema is a nullable object, so
  // there is no enum to read. Callers must treat options as optional.
  test("returns undefined when the schema is not an enum", () => {
    expect(optionsFor("availability.quietHours")).toBeUndefined();
    expect(optionsFor("cost.dailyCapUsd")).toBeUndefined();
    expect(optionsFor("welcome.newMemberText")).toBeUndefined();
  });

  // The whole point: a value the model proposes must be one of these, and
  // every listed option must actually parse.
  test("every listed option parses against its own schema", () => {
    for (const key of SETTING_KEYS) {
      for (const option of optionsFor(key) ?? []) {
        expect(
          BOT_SETTINGS[key].schema.safeParse(option).success,
          `${key} rejects its own option ${option}`,
        ).toBe(true);
      }
    }
  });
});
