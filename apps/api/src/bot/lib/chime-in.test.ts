import { z } from "zod";
import { beforeEach, describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  preFilter,
  offCooldown,
  hasLookedUp,
  hasAttemptedSilence,
  applyConfidenceGate,
  chimeDecisionSchema,
  recordChime,
  lastChimeAt,
  resetChimeHistory,
  CHIME_IN_COOLDOWN_MS,
  CHIME_IN_MIN_CONFIDENCE,
  inQuietHours,
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

describe("inQuietHours", () => {
  const at = (hhmm: string) => new Date(`2026-08-22T${hhmm}:00+08:00`);

  test("null window is never quiet", () => {
    expect(inQuietHours(null, at("03:00"))).toBe(false);
  });

  test("inside a same-day window", () => {
    expect(inQuietHours({ start: "13:00", end: "15:00" }, at("14:00"))).toBe(true);
  });

  test("outside a same-day window", () => {
    expect(inQuietHours({ start: "13:00", end: "15:00" }, at("16:00"))).toBe(false);
  });

  test("a window wrapping midnight covers the late evening", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("23:30"))).toBe(true);
  });

  test("a window wrapping midnight covers the early morning", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("02:00"))).toBe(true);
  });

  test("a window wrapping midnight excludes the afternoon", () => {
    expect(inQuietHours({ start: "23:00", end: "07:00" }, at("14:00"))).toBe(false);
  });

  test("the start minute is inside, the end minute is outside", () => {
    const w = { start: "23:00", end: "07:00" };
    expect(inQuietHours(w, at("23:00"))).toBe(true);
    expect(inQuietHours(w, at("07:00"))).toBe(false);
  });
});

describe("hasLookedUp", () => {
  const call = (toolName: string): ModelMessage => ({
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: "1", toolName, input: {} },
    ],
  });

  test("no tool calls at all — has not looked", () => {
    expect(hasLookedUp([{ role: "user", content: "anyone tried X?" }])).toBe(false);
  });

  test("searching the chat counts", () => {
    expect(hasLookedUp([call("chat_history")])).toBe(true);
  });

  test("looking up members counts", () => {
    expect(hasLookedUp([call("members")])).toBe(true);
  });

  test("querying community data counts", () => {
    expect(hasLookedUp([call("graphql_query")])).toBe(true);
  });

  /**
   * The grounding rule turns on what the community knows. Searching the web is
   * not checking whether this chat already answered the question.
   */
  test("web research alone does not count", () => {
    expect(hasLookedUp([call("research")])).toBe(false);
  });

  test("reaching for stay_silent first does not count as looking", () => {
    expect(hasLookedUp([call("stay_silent")])).toBe(false);
  });

  test("a plain-text assistant turn is not a tool call", () => {
    expect(hasLookedUp([{ role: "assistant", content: "let me check" }])).toBe(false);
  });

  test("finds the lookup anywhere in the conversation", () => {
    expect(
      hasLookedUp([
        { role: "user", content: "anyone tried X?" },
        call("research"),
        call("chat_history"),
      ]),
    ).toBe(true);
  });
});

describe("hasAttemptedSilence", () => {
  const call = (toolName: string): ModelMessage => ({
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "1", toolName, input: {} }],
  });

  test("no attempt yet", () => {
    expect(hasAttemptedSilence([call("chat_history")])).toBe(false);
  });

  test("a prior attempt is remembered, so the refusal fires only once", () => {
    expect(hasAttemptedSilence([call("stay_silent")])).toBe(true);
  });

  /**
   * The pairing that matters: skipped the lookup AND already refused once, so
   * the second attempt must be honoured rather than argued with.
   */
  test("insisting after a refusal is not blocked again", () => {
    const conversation = [call("stay_silent")];
    expect(hasLookedUp(conversation)).toBe(false);
    expect(hasAttemptedSilence(conversation)).toBe(true);
  });
});
