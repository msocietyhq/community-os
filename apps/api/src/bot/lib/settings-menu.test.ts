import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import {
  PAUSE_PRESETS,
  renderConfirmation,
  renderDraftCard,
  renderIndexPage,
  renderSettingPage,
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
  test("lists one button per setting in the group plus navigation", () => {
    const page = renderIndexPage("behaviour", snapshot);
    // 5 behaviour settings each on their own row, then a nav row, then history.
    expect(page.keyboard.inline_keyboard).toHaveLength(7);
    expect(page.text).toContain("Behaviour");
  });

  test("button labels carry the current value", () => {
    expect(labels(renderIndexPage("behaviour", snapshot))).toContain(
      "Chime-ins · on",
    );
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
