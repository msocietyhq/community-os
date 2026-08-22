import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  keysInGroup,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import {
  PAUSE_PRESETS,
  renderConfirmation,
  renderDraftCard,
  renderIndexPage,
  renderSettingPage,
  INDEX_TABLE_WIDTH,
} from "./settings-menu";
import type { SettingsDraft } from "./settings-draft";

const snapshot = Object.fromEntries(
  Object.entries(BOT_SETTINGS).map(([key, def]) => [key, def.default]),
) as SettingsSnapshot;

const labels = (page: { keyboard: { inline_keyboard: unknown[][] } }) =>
  page.keyboard.inline_keyboard
    .flat()
    .map((b) => (b as { text: string }).text);

describe("renderIndexPage", () => {
  test("packs settings two per row, then navigation and history", () => {
    const page = renderIndexPage("behaviour", snapshot);
    // 5 behaviour settings over 3 rows, then a nav row, then history.
    expect(page.keyboard.inline_keyboard).toHaveLength(5);
    expect(page.text).toContain("Behaviour");
  });

  test("one button per setting, labelled with the name alone", () => {
    const buttons = labels(renderIndexPage("behaviour", snapshot));
    for (const key of keysInGroup("behaviour")) {
      expect(buttons).toContain(BOT_SETTINGS[key].label);
    }
  });

  // Buttons carry no formatting at all, and a long welcome-text preview on a
  // label made every button a different width. Values live in the body's
  // monospace table instead, where they can be aligned.
  test("current values live in the body table, not on buttons", () => {
    const page = renderIndexPage("behaviour", snapshot);
    expect(page.text).toContain("Chime-ins");
    expect(page.text).toMatch(/Chime-ins\s+on/);
    expect(labels(page)).not.toContain("Chime-ins · on");
  });

  // A welcome template is 52 characters — far past the width budget — so text
  // settings collapse to a one-word state here. The content is one tap away.
  test("text settings show a state word, not their content", () => {
    const page = renderIndexPage("welcome", snapshot);
    expect(page.text).toMatch(/New member welcome\s+default/);
    expect(page.text).not.toContain("MSOCIETY");
  });

  test("navigation wraps around the group list", () => {
    const page = renderIndexPage("welcome", snapshot);
    // Last row is Recent changes; the nav pair sits above it.
    const nav = page.keyboard.inline_keyboard.at(-2) ?? [];
    expect(nav).toHaveLength(2);
    expect(nav[0]?.text).toContain("Behaviour");
    expect(nav[1]?.text).toContain("Availability");
  });

  test("renders every group without throwing", () => {
    for (const group of SETTING_GROUPS) {
      expect(() => renderIndexPage(group, snapshot)).not.toThrow();
    }
  });

  // Telegram wraps a <pre> block past roughly 30 monospace characters on a
  // narrow phone, which would destroy the alignment. A future long label or a
  // long formatted value must fail here rather than in production.
  test("no table row exceeds the monospace width budget", () => {
    for (const group of SETTING_GROUPS) {
      const page = renderIndexPage(group, snapshot);
      const table = page.text.match(/<pre>([\s\S]*)<\/pre>/)?.[1] ?? "";
      for (const row of table.split("\n")) {
        expect(
          Array.from(row).length,
          `${group}: "${row}" is wider than the budget`,
        ).toBeLessThanOrEqual(INDEX_TABLE_WIDTH);
      }
    }
  });

  test("values are right-aligned to a common edge", () => {
    const page = renderIndexPage("behaviour", snapshot);
    const table = page.text.match(/<pre>([\s\S]*)<\/pre>/)?.[1] ?? "";
    const widths = new Set(
      table.split("\n").map((row) => Array.from(row).length),
    );
    expect(widths.size, "every row should end at the same column").toBe(1);
  });

  // Telegram rejects a lone surrogate with "button text must be encoded in
  // UTF-8" and fails the WHOLE message — one bad label takes down the entire
  // page. The Welcome index hit this for real: a 30-code-unit slice cut 👋 in
  // half. A UTF-8 round-trip replaces invalid sequences, so inequality
  // detects precisely what Telegram would reject.
  test("every button label on every index page is valid UTF-8", () => {
    for (const group of SETTING_GROUPS) {
      const page = renderIndexPage(group, snapshot);
      for (const button of page.keyboard.inline_keyboard.flat()) {
        expect(
          Buffer.from(button.text, "utf8").toString("utf8"),
          `${group}: "${button.text}" is not valid UTF-8`,
        ).toBe(button.text);
      }
    }
  });
});

describe("renderSettingPage", () => {
  test("shows the description, current value and default", () => {
    const page = renderSettingPage("chimeIn.enabled", snapshot, null);
    expect(page.text).toContain(BOT_SETTINGS["chimeIn.enabled"].description);
    expect(page.text).toContain("Current:");
    expect(page.text).toContain("Default:");
  });

  test("a toggle offers the opposite value", () => {
    expect(labels(renderSettingPage("chimeIn.enabled", snapshot, null))).toContain(
      "Turn off",
    );
  });

  test("a pause control offers every preset", () => {
    const page = renderSettingPage("ai.replies", snapshot, null);
    for (const preset of PAUSE_PRESETS) {
      expect(labels(page)).toContain(preset.label);
    }
  });

  test("every setting renders without throwing", () => {
    for (const key of SETTING_KEYS) {
      expect(() => renderSettingPage(key, snapshot, null)).not.toThrow();
    }
  });

  // The setting page is where admin-authored welcome text actually reaches a
  // formatted message. Unescaped, a stray `<` makes Telegram reject the whole
  // page — the same class of failure as the lone-surrogate bug.
  test("HTML in a setting's value is escaped, not interpreted", () => {
    const hostile = {
      ...snapshot,
      "welcome.newMemberText": "<b>hi</b> & bye",
    };
    const page = renderSettingPage("welcome.newMemberText", hostile, null);
    expect(page.text).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; bye");
    expect(page.text).not.toContain("<b>hi</b>");
  });

  test("every generated callback fits Telegram's limit", () => {
    for (const key of SETTING_KEYS) {
      const page = renderSettingPage(key, snapshot, null);
      for (const button of page.keyboard.inline_keyboard.flat()) {
        if ("callback_data" in button && button.callback_data) {
          expect(
            Buffer.byteLength(button.callback_data, "utf8"),
            `${button.callback_data} is too long`,
          ).toBeLessThanOrEqual(64);
        }
      }
    }
  });
});

describe("renderConfirmation", () => {
  test("shows the before and after", () => {
    const page = renderConfirmation({
      key: "chimeIn.enabled",
      from: true,
      to: false,
    });
    expect(page.text).toContain("on");
    expect(page.text).toContain("off");
    expect(labels(page)).toContain("Undo");
  });
});

describe("renderDraftCard", () => {
  const draft: SettingsDraft = {
    changes: [
      { key: "chimeIn.enabled", from: true, to: false },
      { key: "cost.dailyCapUsd", from: 10, to: 4 },
    ],
    rationale: "quiet week",
    createdAt: 0,
    messageId: 0,
  };

  test("lists every change with a drop button each", () => {
    const page = renderDraftCard(draft, []);
    expect(labels(page).filter((l) => l.startsWith("✕"))).toHaveLength(2);
    expect(labels(page)).toContain("✓ Confirm all");
  });

  test("includes the rationale", () => {
    expect(renderDraftCard(draft, []).text).toContain("quiet week");
  });

  test("marks drifted rows and drops the confirm button", () => {
    const page = renderDraftCard(draft, [
      { key: "cost.dailyCapUsd", from: 10, to: 4, current: 25 },
    ]);
    expect(page.text).toContain("changed since");
    expect(labels(page)).not.toContain("✓ Confirm all");
  });

  test("an empty draft offers nothing to confirm", () => {
    const page = renderDraftCard({ ...draft, changes: [] }, []);
    expect(labels(page)).not.toContain("✓ Confirm all");
  });
});
