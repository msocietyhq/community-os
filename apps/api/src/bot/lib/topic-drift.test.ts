import { z } from "zod";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  preFilter,
  applyDriftConfidenceGate,
  driftDecisionSchema,
  topicKey,
  currentStreak,
  recordOffTopic,
  resetStreak,
  recordReminder,
  lastReminderAt,
  resetDriftHistory,
  renderReminder,
  TOPIC_DRIFT_MIN_CONFIDENCE,
} from "./topic-drift";

describe("preFilter", () => {
  test("lets a plausible message through", () => {
    expect(
      preFilter({
        text: "anyone here into competitive powerlifting?",
        isBot: false,
      }),
    ).toBeNull();
  });

  test("never judges the bot's own messages", () => {
    expect(preFilter({ text: "some ordinary message here", isBot: true })).toBe(
      "from_bot",
    );
  });

  test("skips commands", () => {
    expect(preFilter({ text: "/help me with something", isBot: false })).toBe(
      "command",
    );
  });

  test("skips messages too short to carry a subject either way", () => {
    expect(preFilter({ text: "lol", isBot: false })).toBe("too_short");
    expect(preFilter({ text: "same", isBot: false })).toBe("too_short");
  });

  test("a short-but-substantial message reaches the judge", () => {
    expect(preFilter({ text: "what movie is this", isBot: false })).toBeNull();
  });
});

describe("applyDriftConfidenceGate", () => {
  const yes = (confidence: number, reason = "different subject") => ({
    offTopic: true,
    confidence,
    reason,
  });

  test("accepts a confident off-topic verdict", () => {
    const d = applyDriftConfidenceGate(yes(0.95));
    expect(d.offTopic).toBe(true);
    expect(d.confidence).toBe(0.95);
  });

  test("an off-topic verdict below the confidence floor becomes on-topic", () => {
    const d = applyDriftConfidenceGate(
      yes(TOPIC_DRIFT_MIN_CONFIDENCE - 0.01, "maybe"),
    );
    expect(d.offTopic).toBe(false);
    expect(d.reason).toContain("below threshold");
  });

  test("exactly at the floor is accepted", () => {
    expect(
      applyDriftConfidenceGate(yes(TOPIC_DRIFT_MIN_CONFIDENCE)).offTopic,
    ).toBe(true);
  });

  test("an explicit on-topic verdict stays on-topic regardless of confidence", () => {
    const d = applyDriftConfidenceGate({
      offTopic: false,
      confidence: 1,
      reason: "related",
    });
    expect(d.offTopic).toBe(false);
  });

  test("a confidence outside 0-1 still fails the comparison safely", () => {
    expect(applyDriftConfidenceGate(yes(-1)).offTopic).toBe(false);
    expect(applyDriftConfidenceGate(yes(Number.NaN)).offTopic).toBe(false);
  });

  test("respects an explicit threshold", () => {
    expect(applyDriftConfidenceGate(yes(0.5), 0.4).offTopic).toBe(true);
    expect(applyDriftConfidenceGate(yes(0.5), 0.6).offTopic).toBe(false);
  });
});

describe("driftDecisionSchema", () => {
  test("carries no numeric bounds — Anthropic structured output rejects them", () => {
    const json = z.toJSONSchema(driftDecisionSchema);
    const serialised = JSON.stringify(json);
    expect(serialised).not.toContain("minimum");
    expect(serialised).not.toContain("maximum");
  });

  test("rejects a non-boolean offTopic rather than truthy-coercing", () => {
    expect(
      driftDecisionSchema.safeParse({
        offTopic: "true",
        confidence: 1,
        reason: "x",
      }).success,
    ).toBe(false);
  });

  test("accepts a well-formed decision", () => {
    expect(
      driftDecisionSchema.safeParse({
        offTopic: true,
        confidence: 0.9,
        reason: "ok",
      }).success,
    ).toBe(true);
  });
});

describe("topicKey", () => {
  test("distinguishes topics within the same chat", () => {
    expect(topicKey("1", 10)).not.toBe(topicKey("1", 20));
  });

  test("distinguishes the same thread id across chats", () => {
    expect(topicKey("1", 10)).not.toBe(topicKey("2", 10));
  });
});

describe("streak and cooldown state", () => {
  beforeEach(() => {
    resetDriftHistory();
  });

  test("starts at zero for an unseen topic", () => {
    expect(currentStreak(topicKey("1", 10))).toBe(0);
  });

  test("counts consecutive off-topic verdicts", () => {
    const key = topicKey("1", 10);
    expect(recordOffTopic(key)).toBe(1);
    expect(recordOffTopic(key)).toBe(2);
    expect(recordOffTopic(key)).toBe(3);
    expect(currentStreak(key)).toBe(3);
  });

  test("an on-topic message resets the streak", () => {
    const key = topicKey("1", 10);
    recordOffTopic(key);
    recordOffTopic(key);
    resetStreak(key);
    expect(currentStreak(key)).toBe(0);
  });

  test("topics track streaks independently", () => {
    const a = topicKey("1", 10);
    const b = topicKey("1", 20);
    recordOffTopic(a);
    recordOffTopic(a);
    recordOffTopic(b);
    expect(currentStreak(a)).toBe(2);
    expect(currentStreak(b)).toBe(1);
  });

  test("sending a reminder resets the streak and starts the cooldown", () => {
    const key = topicKey("1", 10);
    recordOffTopic(key);
    recordOffTopic(key);
    recordOffTopic(key);
    const now = 1_800_000_000_000;
    recordReminder(key, now);
    expect(currentStreak(key)).toBe(0);
    expect(lastReminderAt(key)).toBe(now);
  });

  test("no reminder recorded yet for an unseen topic", () => {
    expect(lastReminderAt(topicKey("1", 10))).toBeUndefined();
  });
});

describe("renderReminder", () => {
  test("substitutes the topic placeholder", () => {
    expect(renderReminder("This is about {topic}.", "Jobs")).toBe(
      "This is about Jobs.",
    );
  });

  test("substitutes every occurrence", () => {
    expect(renderReminder("{topic}! ({topic})", "Jobs")).toBe("Jobs! (Jobs)");
  });

  test("leaves a template with no placeholder untouched", () => {
    expect(renderReminder("Let's stay on track.", "Jobs")).toBe(
      "Let's stay on track.",
    );
  });
});
