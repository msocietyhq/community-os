import { aiService } from "../../services/ai.service";
import {
  JUDGE_PROMPT,
  applyConfidenceGate,
  chimeDecisionSchema,
  type ChimeDecision,
  type ChimeInInput,
} from "./chime-in";

/**
 * Asks the judge. Errors resolve to silence rather than propagating — this
 * runs on ordinary chat traffic and must never disrupt it.
 */
export async function judgeChimeIn(input: ChimeInInput): Promise<ChimeDecision> {
  try {
    const result = await aiService.generateObject(
      {
        schema: chimeDecisionSchema,
        system: JUDGE_PROMPT,
        messages: [
          {
            role: "user",
            content: `${input.transcript}\n\nLatest message to judge:\n"${input.message}"`,
          },
        ],
        maxOutputTokens: 256,
      },
      {
        caller: "chime-in-judge",
        tier: "micro",
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      },
    );

    // Widened to `unknown` by the tracking wrapper; re-parse to recover the type.
    return applyConfidenceGate(
      chimeDecisionSchema.parse(result.object),
      input.minConfidence,
    );
  } catch (err) {
    console.error("[chime-in] judge failed:", err);
    return { respond: false, confidence: 0, reason: "judge error" };
  }
}
