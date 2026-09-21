import { aiService } from "../../services/ai.service";
import {
  JUDGE_PROMPT,
  applyDriftConfidenceGate,
  driftDecisionSchema,
  type DriftDecision,
  type TopicDriftInput,
} from "./topic-drift";

/**
 * Asks the judge whether the latest message has drifted off the topic's
 * subject. Returns null on any failure rather than propagating or faking a
 * verdict — this runs on ordinary chat traffic and must never disrupt it.
 *
 * null is a type-level signal, not a string a caller has to compare against
 * `reason` — the judge's `reason` field is free-text model output, and
 * nothing about it should have to be reserved to mean "this wasn't really a
 * verdict". A caller sees null and knows to leave a build-up streak
 * untouched, the same as it would for any other lookup that came back
 * empty.
 */
export async function judgeTopicDrift(
  input: TopicDriftInput,
): Promise<DriftDecision | null> {
  try {
    const result = await aiService.generateObject(
      {
        schema: driftDecisionSchema,
        system: JUDGE_PROMPT,
        messages: [
          {
            role: "user",
            content: `Topic subject: "${input.topicName}"\n\n${input.transcript}\n\nLatest message to judge:\n"${input.message}"`,
          },
        ],
        maxOutputTokens: 256,
      },
      {
        caller: "topic-drift-judge",
        tier: "micro",
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      },
    );

    // Widened to `unknown` by the tracking wrapper; re-parse to recover the type.
    return applyDriftConfidenceGate(
      driftDecisionSchema.parse(result.object),
      input.minConfidence,
    );
  } catch (err) {
    console.error("[topic-drift] judge failed:", err);
    return null;
  }
}
