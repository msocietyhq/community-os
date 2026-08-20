import type { ModelMessage } from "ai";

/**
 * Escalation to a stronger model.
 *
 * An advisor is not a fresh agent handed a summary — it continues the calling
 * agent's *actual conversation*, including every tool call and result, on a
 * more capable model. The AI SDK hands `messages` to a tool's execute, so
 * nothing has to be re-derived and there is no handoff summary to get wrong.
 */

export type AdvisorTier = "big" | "bigger";

/** Escalating one rung. `main` consults `big`; `big` consults `bigger`. */
export const NEXT_TIER: Record<"main" | AdvisorTier, AdvisorTier | null> = {
  main: "big",
  big: "bigger",
  bigger: null,
};

export const ADVISOR_NAMES: Record<AdvisorTier, string> = {
  big: "Big Brain",
  bigger: "Bigger Brain",
};

export const ADVISOR_TOOL_NAMES: Record<AdvisorTier, string> = {
  big: "big_brain_advisor",
  bigger: "bigger_brain_advisor",
};

/**
 * Thinking is on by default on these models, and max output tokens caps
 * thinking *plus* the reply — a small budget yields a truncated answer.
 */
export const ADVISOR_MAX_OUTPUT_TOKENS = 8192;

export const ADVISOR_DESCRIPTIONS: Record<AdvisorTier, string> = {
  big: [
    "Consult a stronger model when a question needs real reasoning rather than lookup —",
    "weighing trade-offs, untangling a confusing situation, planning something multi-step,",
    "or when your own answer feels thin and you're going in circles.",
    "It sees this entire conversation, including everything you've already tried,",
    "so describe what you're stuck on rather than restating the question.",
    "It returns advice for you to relay, not a finished reply.",
  ].join(" "),

  bigger: [
    "Escalate to the most capable model for genuinely hard problems: subtle trade-offs",
    "with no clean answer, unfamiliar territory, dense or ambiguous reasoning, or when",
    "big_brain_advisor came back unconvincing or contradicted itself.",
    "Slow and costly — reach for it when the question is worth the wait, not as a first move.",
    "It sees this entire conversation, so describe what remains unresolved.",
  ].join(" "),
};

export function advisorSystemPrompt(tier: AdvisorTier): string {
  return `You are the ${ADVISOR_NAMES[tier]} advisor for the MSOCIETY community bot.

A less capable agent got stuck and escalated to you. Everything above is its
actual conversation — the member's messages, the tools it called, and what those
tools returned. You have the same tools it does.

Work the problem. Call tools when you need facts the conversation doesn't
already contain; don't re-run a lookup whose result is already above.

Answer the specific thing you were escalated for. Be direct about uncertainty:
if the conversation doesn't contain enough to answer, say what's missing rather
than guessing. Your reply goes back to the agent that called you, which will
relay it to a member in Telegram — so keep it tight and free of meta-commentary
about being an advisor.`;
}

/**
 * Drops tool calls that have no matching result.
 *
 * The advisor's own tool call is in flight when it reads the conversation, and
 * a dangling call would be rejected as a malformed turn by the next model.
 * Anything already resolved is preserved untouched.
 */
export function sanitizeForHandoff(messages: ModelMessage[]): ModelMessage[] {
  const resolved = new Set<string>();

  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-result") resolved.add(part.toolCallId);
    }
  }

  const cleaned: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      cleaned.push(message);
      continue;
    }

    const parts = message.content.filter(
      (part) => part.type !== "tool-call" || resolved.has(part.toolCallId),
    );

    // An assistant turn that was nothing but the in-flight call is dropped.
    if (parts.length > 0) {
      cleaned.push({ ...message, content: parts } as ModelMessage);
    }
  }

  return cleaned;
}

/** Frames the escalation as the final turn the advisor responds to. */
export function buildAdvisorMessages(
  conversation: ModelMessage[],
  problem: string,
): ModelMessage[] {
  return [
    ...sanitizeForHandoff(conversation),
    {
      role: "user",
      content: `[Escalated by the assistant that was handling this conversation]\n\n${problem}`,
    },
  ];
}
