import { describe, expect, test } from "bun:test";
import {
  BOT_SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  keysInGroup,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import { AI_CATALOG, modelKeysForTier } from "@community-os/shared/ai-catalog";
import {
  PAUSE_PRESETS,
  renderConfirmation,
  renderDraftCard,
  renderApplied,
  HISTORY_PAGE_SIZE,
  renderHistoryPage,
  renderIndexPage,
  renderSettingPage,
  type HistoryRow,
  type RenderedPage,
} from "./settings-menu";
import type { SettingsDraft } from "./settings-draft";

const snapshot = Object.fromEntries(
  Object.entries(BOT_SETTINGS).map(([key, def]) => [key, def.default]),
) as SettingsSnapshot;

const labels = (page: { keyboard: { inline_keyboard: unknown[][] } }) =>
  page.keyboard.inline_keyboard.flat().map((b) => (b as { text: string }).text);

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
  // label made every button a different width. Values live in the body
  // instead, where they can be italicised.
  test("current values appear italicised in the body, not on buttons", () => {
    const page = renderIndexPage("behaviour", snapshot);
    expect(page.text).toContain("Chime-ins — <code>on</code>");
    expect(labels(page)).not.toContain("Chime-ins · on");
  });

  // A welcome template runs to 52 characters and swamped the line, so text
  // settings collapse to a one-word state. The content is one tap away.
  test("text settings show a state word, not their content", () => {
    const page = renderIndexPage("welcome", snapshot);
    expect(page.text).toContain("New member welcome — <code>default</code>");
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
    expect(
      labels(renderSettingPage("chimeIn.enabled", snapshot, null)),
    ).toContain("Turn off");
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

// The draft card shipped once rendering HTML but sent as Markdown, showing an
// admin raw <b> tags. The mode now travels on the page so no call site can
// contradict it — this pins that every renderer supplies it.
describe("parse mode", () => {
  test("every renderer declares HTML", () => {
    const pages = [
      renderIndexPage("cost", snapshot),
      renderSettingPage("cost.dailyCapUsd", snapshot, null),
      renderConfirmation({ key: "chimeIn.enabled", from: true, to: false }),
      renderDraftCard(
        {
          changes: [{ key: "chimeIn.enabled", from: true, to: false }],
          createdAt: 0,
          messageId: 0,
        },
        [],
      ),
      renderApplied([{ key: "chimeIn.enabled", from: true, to: false }]),
    ];

    for (const page of pages) {
      expect(page.parseMode).toBe("HTML");
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

describe("model setting page", () => {
  test("offers every model allowed for the tier, by label", () => {
    const buttons = labels(renderSettingPage("ai.model.fast", snapshot, null));

    for (const key of modelKeysForTier("fast")) {
      expect(buttons, key).toContain(AI_CATALOG[key].label);
    }
  });

  test("never puts more than two models on a row", () => {
    const page = renderSettingPage("ai.model.smart", snapshot, null);
    const modelLabels = new Set(
      modelKeysForTier("smart").map((k) => AI_CATALOG[k].label),
    );

    for (const row of page.keyboard.inline_keyboard) {
      const onRow = row.filter((b) => modelLabels.has(b.text));
      expect(onRow.length).toBeLessThanOrEqual(2);
    }
  });

  test("does not leak the quiet-hours presets onto a model page", () => {
    const buttons = labels(renderSettingPage("ai.model.deep", snapshot, null));
    expect(buttons).not.toContain("23:00-07:00");
  });
});

// The history page shipped rendering only a label, an action and a date —
// "Monthly cap · update · 2026-08-22 · via AI". Every question an audit trail
// exists to answer (who, and from what to what) was already in the row and was
// thrown away by the renderer. These pin that it stays rendered — and that the
// page reports what changed, without the AI's account of why.
describe("renderHistoryPage", () => {
  const at = new Date("2026-08-22T03:31:15.648Z"); // 11:31 on 22 Aug in SGT
  const later = new Date("2026-08-29T21:25:30.255Z"); // 05:25 on 30 Aug in SGT

  const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
    key: "cost.monthlyCapUsd",
    action: "update",
    from: 30,
    to: 25,
    actor: { name: "@modulus" },
    at,
    ...over,
  });

  test("names who made the change", () => {
    const page = renderHistoryPage([row()], null);
    expect(page.text).toContain("@modulus");
  });

  test("shows what the change was, in the setting's own units", () => {
    const page = renderHistoryPage([row()], null);
    expect(page.text).toContain("$30/mo");
    expect(page.text).toContain("$25/mo");
  });

  // Values are marked as code, not italics: they are literals to be read
  // exactly. The escaping has to survive the change of tag — `<code>` does not
  // make its contents safe, Telegram still parses entities inside it.
  test("values render as code, and are escaped inside it", () => {
    expect(renderHistoryPage([row()], null).text).toContain(
      "<code>$30/mo</code>",
    );

    const hostile = renderHistoryPage(
      [row({ key: "welcome.newMemberText", from: "<b>hi</b> & bye", to: "x" })],
      null,
    );
    expect(hostile.text).toContain(
      "<code>&lt;b&gt;hi&lt;/b&gt; &amp; bye</code>",
    );
    expect(hostile.text).not.toContain("<b>hi</b>");
  });

  test("a change with no recorded actor reads as system, not as nobody", () => {
    const page = renderHistoryPage([row({ actor: null })], null);
    expect(page.text).toContain("system");
  });

  // The three cost changes in the real trail were one draft applied
  // milliseconds apart. Repeating "@modulus · 22 Aug" under each is what the
  // grouping exists to avoid; each setting still gets its own line.
  test("changes by one admin on one day share a header", () => {
    const page = renderHistoryPage(
      [
        row(),
        row({ key: "cost.dailyCapUsd", from: 5, to: 2 }),
        row({ key: "cost.alertThresholdUsd", from: null, to: 0.5 }),
      ],
      null,
    );

    expect(page.text.match(/@modulus/g)).toHaveLength(1);
    expect(page.text).toContain("Monthly cap");
    expect(page.text).toContain("Daily cap");
    expect(page.text).toContain("Spend alert");
  });

  test("a different actor starts a new group", () => {
    const page = renderHistoryPage(
      [row(), row({ actor: { name: "@someoneelse" } })],
      null,
    );
    expect(page.text.match(/@modulus/g)).toHaveLength(1);
    expect(page.text.match(/@someoneelse/g)).toHaveLength(1);
  });

  test("a different day starts a new group", () => {
    const page = renderHistoryPage([row({ at: later }), row()], null);
    expect(page.text.match(/@modulus/g)).toHaveLength(2);
  });

  // How a change was made is not what the trail is for: an admin confirmed it
  // either way, and labelling one "via AI" invited the model's stated intent
  // to be read as a record of what it did.
  test("a change carries no trace of whether the AI drafted it", () => {
    const page = renderHistoryPage([row(), row()], null);
    expect(page.text).not.toContain("AI");
    expect(page.text.match(/@modulus/g)).toHaveLength(1);
  });

  test("marks a reset or an undo, but does not label every row 'update'", () => {
    const page = renderHistoryPage(
      [row({ action: "reset" }), row({ action: "update" })],
      null,
    );
    expect(page.text).toContain("reset");
    expect(page.text).not.toContain("update");
  });

  // A historical value was never re-validated on the way out of jsonb: it may
  // name a model since dropped from the catalog, whose `format` is
  // `AI_CATALOG[v].label` and throws on a missing key. One bad row must not
  // take down the whole page.
  test("a value the setting no longer accepts renders raw, not thrown", () => {
    const page = renderHistoryPage(
      [
        row({
          key: "ai.model.fast",
          from: "anthropic/model-since-deleted",
          to: "anthropic/haiku-4-5",
        }),
      ],
      null,
    );
    expect(page.text).toContain("anthropic/model-since-deleted");
  });

  test("a key that is no longer a setting still renders", () => {
    expect(() =>
      renderHistoryPage([row({ key: "cost.removedSetting" })], null),
    ).not.toThrow();
  });

  // `format` for a text setting collapses to "custom", which as a history line
  // reads "custom → custom" and answers nothing.
  test("a text setting shows a preview of the text, not 'custom'", () => {
    const page = renderHistoryPage(
      [
        row({
          key: "welcome.newMemberText",
          from: "Welcome aboard",
          to: "Welcome to MSOCIETY",
        }),
      ],
      null,
    );
    expect(page.text).toContain("Welcome to MSOCIETY");
    expect(page.text).not.toContain("custom → custom");
  });

  // A display name is whatever the member typed into Telegram, reaching a
  // formatted message; Telegram rejects the whole message if the markup fails
  // to parse.
  test("HTML in a display name is escaped, not interpreted", () => {
    const page = renderHistoryPage(
      [row({ actor: { name: "<b>evil</b> & co" } })],
      null,
    );
    expect(page.text).toContain("&lt;b&gt;evil&lt;/b&gt; &amp; co");
    expect(page.text).not.toContain("<b>evil</b>");
  });

  test("an empty trail says so and still offers a way back", () => {
    const page = renderHistoryPage([], null);
    expect(page.text).toContain("No changes recorded yet");
    expect(page.keyboard.inline_keyboard.flat()).toHaveLength(1);
  });

  test("back goes to the setting when scoped, to the index when not", () => {
    const backTo = (page: RenderedPage) => {
      const button = page.keyboard.inline_keyboard.flat()[0];
      return button && "callback_data" in button ? button.callback_data : null;
    };

    expect(backTo(renderHistoryPage([row()], "cost.monthlyCapUsd"))).toBe(
      "set:view:cost.monthlyCapUsd",
    );
    expect(backTo(renderHistoryPage([row()], null))).toContain("set:idx:");
  });

  // Telegram rejects a message over 4096 characters outright, so an oversized
  // page shows the admin nothing at all — not a clipped list. Grouping made
  // each entry taller than the single line it used to be, so entries are
  // paginated rather than dropped: nothing in the trail becomes unreachable.
  test("a full window stays inside Telegram's limit at its worst", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) =>
      row({
        key: "welcome.newMemberText",
        action: "undo",
        from: "🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌",
        to: "🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌🕌",
        // A display name is whatever the member typed into Telegram.
        actor: { name: "🧢".repeat(80) },
        at: new Date(Date.UTC(2026, 7, 22 - i)),
      }),
    );

    const page = renderHistoryPage(rows, null, 0);

    // Telegram counts the text after entities are parsed, so markup is free.
    const visible = page.text.replace(/<\/?(?:b|i|code)>/g, "");
    expect(visible.length).toBeLessThanOrEqual(4096);

    // The page stopped filling early — and this is the half that matters:
    // whatever it dropped is what `Older` resumes from, so no entry falls
    // between two pages.
    const rendered = (page.text.match(/• /g) ?? []).length;
    expect(rendered).toBeLessThan(HISTORY_PAGE_SIZE);

    const older = page.keyboard.inline_keyboard
      .flat()
      .find((b) => b.text.includes("Older"));
    expect(older && "callback_data" in older ? older.callback_data : null).toBe(
      `set:hist::${rendered}`,
    );
  });

  test("a first page with more behind it offers older but not newer", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) =>
      row({ at: new Date(at.getTime() - i * 86_400_000) }),
    );
    const buttons = labels(renderHistoryPage(rows, null, 0));
    expect(buttons.some((b) => b.includes("Older"))).toBe(true);
    expect(buttons.some((b) => b.includes("Newer"))).toBe(false);
  });

  test("the extra look-ahead entry is not itself rendered", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) =>
      row({ at: new Date(at.getTime() - i * 86_400_000) }),
    );
    const page = renderHistoryPage(rows, null, 0);
    expect(page.text.match(/Monthly cap/g)).toHaveLength(HISTORY_PAGE_SIZE);
  });

  test("a last page offers newer but not older", () => {
    const buttons = labels(renderHistoryPage([row()], null, HISTORY_PAGE_SIZE));
    expect(buttons.some((b) => b.includes("Older"))).toBe(false);
    expect(buttons.some((b) => b.includes("Newer"))).toBe(true);
  });

  test("a single full page offers no pagination at all", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) =>
      row({ at: new Date(at.getTime() - i * 86_400_000) }),
    );
    const buttons = labels(renderHistoryPage(rows, null, 0));
    expect(buttons.some((b) => b.includes("Older"))).toBe(false);
    expect(buttons.some((b) => b.includes("Newer"))).toBe(false);
  });

  test("older carries the offset past what this page showed", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, i) =>
      row({ at: new Date(at.getTime() - i * 86_400_000) }),
    );
    const page = renderHistoryPage(rows, "cost.monthlyCapUsd", 0);
    const next = page.keyboard.inline_keyboard
      .flat()
      .find((b) => b.text.includes("Older"));
    expect(next && "callback_data" in next ? next.callback_data : null).toBe(
      `set:hist:cost.monthlyCapUsd:${HISTORY_PAGE_SIZE}`,
    );
  });

  test("newer never walks off the start of the trail", () => {
    const page = renderHistoryPage([row()], null, 4);
    const prev = page.keyboard.inline_keyboard
      .flat()
      .find((b) => b.text.includes("Newer"));
    expect(prev && "callback_data" in prev ? prev.callback_data : null).toBe(
      "set:hist::0",
    );
  });

  test("every pagination callback fits Telegram's 64-byte limit", () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, () => row());
    for (const key of SETTING_KEYS) {
      const page = renderHistoryPage(rows, key, 990);
      for (const button of page.keyboard.inline_keyboard.flat()) {
        if ("callback_data" in button && button.callback_data) {
          expect(
            Buffer.byteLength(button.callback_data, "utf8"),
            button.callback_data,
          ).toBeLessThanOrEqual(64);
        }
      }
    }
  });

  test("declares HTML parse mode like every other renderer", () => {
    expect(renderHistoryPage([row()], null).parseMode).toBe("HTML");
  });
});

describe("renderSettingPage attribution", () => {
  test("names who last changed it, not just when", () => {
    const page = renderSettingPage("cost.dailyCapUsd", snapshot, {
      by: "@modulus",
      at: new Date("2026-08-22T03:31:15.648Z"),
    });
    expect(page.text).toContain("@modulus");
    expect(page.text).toContain("Aug");
  });

  test("an unattributed change reads as system", () => {
    const page = renderSettingPage("cost.dailyCapUsd", snapshot, {
      by: null,
      at: new Date("2026-08-22T03:31:15.648Z"),
    });
    expect(page.text).toContain("system");
  });

  test("never changed still reads as never", () => {
    expect(
      renderSettingPage("cost.dailyCapUsd", snapshot, null).text,
    ).toContain("never");
  });
});
