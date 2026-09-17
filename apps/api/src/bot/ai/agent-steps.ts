/**
 * How long a tool loop may run.
 *
 * Ten steps is the usual budget for the main agent and advisors. A turn that
 * has already called `computer` or `exec` gets thirty — the sub-agent reports
 * back, and the parent may need to verify with exec or delegate again. The
 * computer sub-agent itself also gets thirty so it can run, inspect, and
 * check in one go; the next user message is a new conversation.
 */

export const DEFAULT_AGENT_STEPS = 10;
export const COMPUTER_AGENT_STEPS = 30;
/** Own tier so an admin can pick a model without changing chat. */
export const COMPUTER_AGENT_TIER = "computer" as const;

export function stepsUsedComputer(
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string }> }>,
): boolean {
  return steps.some((step) =>
    step.toolCalls.some(
      (call) => call.toolName === "computer" || call.toolName === "exec",
    ),
  );
}

/** Stop after 10 steps, or 30 once `computer` has been called this turn. */
export function computerAwareStepLimit({
  steps,
}: {
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string }> }>;
}): boolean {
  const limit = stepsUsedComputer(steps)
    ? COMPUTER_AGENT_STEPS
    : DEFAULT_AGENT_STEPS;
  return steps.length >= limit;
}
