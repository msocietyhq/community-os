/**
 * How long a main-agent (or advisor) tool loop may run.
 *
 * Ten steps is the usual budget. A turn that has already called `exec` gets
 * thirty — a remote command often needs a follow-up look, and there is no
 * poll loop, so the extra steps have to live in the same turn.
 */

export const DEFAULT_AGENT_STEPS = 10;
export const EXEC_TURN_AGENT_STEPS = 30;

export function stepsUsedExec(
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string }> }>,
): boolean {
  return steps.some((step) =>
    step.toolCalls.some((call) => call.toolName === "exec"),
  );
}

/** Stop after 10 steps, or 30 once `exec` has been called this turn. */
export function execAwareStepLimit({
  steps,
}: {
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string }> }>;
}): boolean {
  const limit = stepsUsedExec(steps)
    ? EXEC_TURN_AGENT_STEPS
    : DEFAULT_AGENT_STEPS;
  return steps.length >= limit;
}
