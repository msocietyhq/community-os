import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_STEPS,
  EXEC_TURN_AGENT_STEPS,
  execAwareStepLimit,
  stepsUsedExec,
} from "./agent-steps";

const step = (...toolNames: string[]) => ({
  toolCalls: toolNames.map((toolName) => ({ toolName })),
});

describe("stepsUsedExec", () => {
  test("false until exec appears", () => {
    expect(stepsUsedExec([])).toBe(false);
    expect(stepsUsedExec([step("graphql_query")])).toBe(false);
  });

  test("true once any step called exec", () => {
    expect(stepsUsedExec([step("exec")])).toBe(true);
    expect(
      stepsUsedExec([step("graphql_query"), step("exec", "recall_memory")]),
    ).toBe(true);
  });
});

describe("execAwareStepLimit", () => {
  test("stops at the default when exec was never called", () => {
    const steps = Array.from({ length: DEFAULT_AGENT_STEPS }, () =>
      step("graphql_query"),
    );
    expect(execAwareStepLimit({ steps: steps.slice(0, 9) })).toBe(false);
    expect(execAwareStepLimit({ steps })).toBe(true);
  });

  test("keeps going past the default once exec has been called", () => {
    const steps = [
      step("exec"),
      ...Array.from({ length: DEFAULT_AGENT_STEPS }, () => step("exec")),
    ];
    expect(steps.length).toBeGreaterThan(DEFAULT_AGENT_STEPS);
    expect(execAwareStepLimit({ steps })).toBe(false);
  });

  test("stops at the exec-turn cap", () => {
    const steps = Array.from({ length: EXEC_TURN_AGENT_STEPS }, () =>
      step("exec"),
    );
    expect(execAwareStepLimit({ steps: steps.slice(0, 29) })).toBe(false);
    expect(execAwareStepLimit({ steps })).toBe(true);
  });

  test("raising the cap on the last default step still allows more", () => {
    const steps = [
      ...Array.from({ length: DEFAULT_AGENT_STEPS - 1 }, () =>
        step("graphql_query"),
      ),
      step("exec"),
    ];
    expect(steps).toHaveLength(DEFAULT_AGENT_STEPS);
    expect(execAwareStepLimit({ steps })).toBe(false);
  });
});
