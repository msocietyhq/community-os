import { z } from "zod";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  preFilter,
  offCooldown,
  applyConfidenceGate,
  chimeDecisionSchema,
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

  test("skips reactions too short to be a real question", () => {
    expect(preFilter({ text: "when?", isBot: false })).toBe("too_short");
    expect(preFilter({ text: "really?", isBot: false })).toBe("too_short");
    expect(preFilter({ text: "WHAT", isBot: false })).toBe("too_short");
  });

  /**
   * Measured against real traffic: a 20-char floor dropped genuine answerable
   * questions. The question-shape check is the real filter.
   */
  test.each([
    "What is docker?",
    "How to be astronaut",
    "Anyone tried this? https://github.com/obra/superpowers",
  ])("short but answerable reaches the judge: %s", (text) => {
    expect(preFilter({ text, isBot: false })).toBeNull();
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

describe("applyConfidenceGate", () => {
  const yes = (confidence: number, reason = "unanswered question") => ({
    respond: true,
    confidence,
    reason,
  });

  test("accepts a confident yes", () => {
    const d = applyConfidenceGate(yes(0.95));
    expect(d.respond).toBe(true);
    expect(d.confidence).toBe(0.95);
  });

  test("a yes below the confidence floor becomes a no", () => {
    const d = applyConfidenceGate(yes(CHIME_IN_MIN_CONFIDENCE - 0.01, "maybe"));
    expect(d.respond).toBe(false);
    expect(d.reason).toContain("below threshold");
  });

  test("exactly at the floor is accepted", () => {
    expect(applyConfidenceGate(yes(CHIME_IN_MIN_CONFIDENCE)).respond).toBe(true);
  });

  test("an explicit no stays no regardless of confidence", () => {
    const d = applyConfidenceGate({ respond: false, confidence: 1, reason: "banter" });
    expect(d.respond).toBe(false);
  });

  test("a confidence outside 0-1 still fails the comparison safely", () => {
    expect(applyConfidenceGate(yes(-1)).respond).toBe(false);
    expect(applyConfidenceGate(yes(Number.NaN)).respond).toBe(false);
  });

  test("respects an explicit threshold", () => {
    expect(applyConfidenceGate(yes(0.5), 0.4).respond).toBe(true);
    expect(applyConfidenceGate(yes(0.5), 0.6).respond).toBe(false);
  });
});

describe("chimeDecisionSchema", () => {
  test("carries no numeric bounds — Anthropic structured output rejects them", () => {
    const json = z.toJSONSchema(chimeDecisionSchema);
    const serialised = JSON.stringify(json);
    expect(serialised).not.toContain("minimum");
    expect(serialised).not.toContain("maximum");
  });

  test("rejects a non-boolean respond rather than truthy-coercing", () => {
    expect(chimeDecisionSchema.safeParse({ respond: "true", confidence: 1, reason: "x" }).success).toBe(false);
    expect(chimeDecisionSchema.safeParse({ respond: 1, confidence: 1, reason: "x" }).success).toBe(false);
  });

  test("accepts a well-formed decision", () => {
    expect(chimeDecisionSchema.safeParse({ respond: true, confidence: 0.9, reason: "ok" }).success).toBe(true);
  });
});
