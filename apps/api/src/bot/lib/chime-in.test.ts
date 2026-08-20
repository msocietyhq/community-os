import { beforeEach, describe, expect, test } from "bun:test";
import {
  preFilter,
  offCooldown,
  parseChimeDecision,
  recordChime,
  lastChimeAt,
  resetChimeHistory,
  CHIME_IN_COOLDOWN_MS,
  CHIME_IN_MIN_CONFIDENCE,
} from "./chime-in";

describe("preFilter", () => {
  test("lets a plausible unanswered question through", () => {
    expect(preFilter({ text: "does anyone know when the next meetup is?", isBot: false })).toBeNull();
    expect(preFilter({ text: "where is the venue for saturday", isBot: false })).toBeNull();
  });

  test("never judges the bot's own messages", () => {
    expect(preFilter({ text: "anyone know when the meetup is?", isBot: true })).toBe("from_bot");
  });

  test("skips commands", () => {
    expect(preFilter({ text: "/help me find the next event", isBot: false })).toBe("command");
  });

  test("skips messages too short to be a real question", () => {
    expect(preFilter({ text: "when?", isBot: false })).toBe("too_short");
  });

  /** The bulk of group chat: reactions, agreement, banter. */
  test.each([
    "haha that was a good one honestly",
    "jazakallah khair for organising that",
    "i agree with that completely, well said",
    "salam everyone hope you are all doing well",
  ])("skips ordinary chat: %s", (text) => {
    expect(preFilter({ text, isBot: false })).toBe("not_a_question");
  });

  test("a bare question mark is enough shape to consider", () => {
    expect(preFilter({ text: "is the hackathon still happening?", isBot: false })).toBeNull();
  });

  test("recognises question shape without a question mark", () => {
    expect(preFilter({ text: "anyone got the link to the projects page", isBot: false })).toBeNull();
  });
});

describe("offCooldown", () => {
  const now = 1_800_000_000_000;

  test("never spoken before means it may speak", () => {
    expect(offCooldown(undefined, now)).toBe(true);
  });

  test("blocked inside the cooldown", () => {
    expect(offCooldown(now - 1000, now)).toBe(false);
  });

  test("allowed once the cooldown has elapsed", () => {
    expect(offCooldown(now - CHIME_IN_COOLDOWN_MS, now)).toBe(true);
  });

  test("the cooldown is configurable", () => {
    expect(offCooldown(now - 50, now, 10)).toBe(true);
    expect(offCooldown(now - 5, now, 10)).toBe(false);
  });
});

describe("parseChimeDecision", () => {
  test("accepts a confident yes", () => {
    const d = parseChimeDecision('{"respond": true, "confidence": 0.95, "reason": "unanswered question"}');
    expect(d.respond).toBe(true);
    expect(d.confidence).toBe(0.95);
  });

  test("a yes below the confidence floor becomes a no", () => {
    const d = parseChimeDecision(
      `{"respond": true, "confidence": ${CHIME_IN_MIN_CONFIDENCE - 0.01}, "reason": "maybe"}`,
    );
    expect(d.respond).toBe(false);
    expect(d.reason).toContain("below threshold");
  });

  test("exactly at the floor is accepted", () => {
    const d = parseChimeDecision(
      `{"respond": true, "confidence": ${CHIME_IN_MIN_CONFIDENCE}, "reason": "clear"}`,
    );
    expect(d.respond).toBe(true);
  });

  test("an explicit no stays no regardless of confidence", () => {
    expect(parseChimeDecision('{"respond": false, "confidence": 1, "reason": "banter"}').respond).toBe(false);
  });

  test("tolerates markdown fences around the json", () => {
    const d = parseChimeDecision('```json\n{"respond": true, "confidence": 0.9, "reason": "ok"}\n```');
    expect(d.respond).toBe(true);
  });

  // ── every malformed shape must fail closed ────────────────────────────────

  test.each([
    ["empty", ""],
    ["undefined", undefined],
    ["prose", "I think the bot should probably respond here"],
    ["broken json", '{"respond": true, "confidence":'],
    ["a bare array", "[1, 2, 3]"],
    ["null literal", "null"],
  ])("fails closed on %s", (_label, raw) => {
    expect(parseChimeDecision(raw as string | undefined).respond).toBe(false);
  });

  test("a missing confidence field is treated as zero", () => {
    const d = parseChimeDecision('{"respond": true, "reason": "no confidence given"}');
    expect(d.respond).toBe(false);
    expect(d.confidence).toBe(0);
  });

  test("a non-boolean respond is not truthy-coerced", () => {
    expect(parseChimeDecision('{"respond": "true", "confidence": 1, "reason": "x"}').respond).toBe(false);
    expect(parseChimeDecision('{"respond": 1, "confidence": 1, "reason": "x"}').respond).toBe(false);
  });
});

describe("cooldown bookkeeping", () => {
  beforeEach(resetChimeHistory);

  test("records and reads back per chat", () => {
    recordChime("-100123", 5000);
    expect(lastChimeAt("-100123")).toBe(5000);
    expect(lastChimeAt("-100999")).toBeUndefined();
  });

  test("chats are rate-limited independently", () => {
    const now = 1_800_000_000_000;
    recordChime("-100123", now);
    expect(offCooldown(lastChimeAt("-100123"), now)).toBe(false);
    expect(offCooldown(lastChimeAt("-100999"), now)).toBe(true);
  });
});

describe("preFilter — tightened by real traffic", () => {
  test("skips messages aimed at a named person", () => {
    expect(
      preFilter({ text: "@Akiddika do you know when the next one is?", isBot: false }),
    ).toBe("directed_at_person");
  });

  test("skips a shared link with a few words around it", () => {
    expect(
      preFilter({
        text: "anyone seen this? https://x.com/someone/status/2041566601426956391",
        isBot: false,
      }),
    ).toBe("mostly_link");
  });

  test("a real question that happens to cite a link still passes", () => {
    expect(
      preFilter({
        text: "does anyone know if the venue on https://msociety.dev is still bookable for saturday",
        isBot: false,
      }),
    ).toBeNull();
  });

  test("a bare link is reported as a link, not as too short", () => {
    expect(preFilter({ text: "https://example.com/a/b/c", isBot: false })).toBe("mostly_link");
  });

  test("short text with no link is still too_short", () => {
    expect(preFilter({ text: "when?", isBot: false })).toBe("too_short");
  });
});
