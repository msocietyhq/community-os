import { describe, expect, test } from "bun:test";
import {
  COMPUTER_AGENT_STEPS,
  DEFAULT_AGENT_STEPS,
  computerAwareStepLimit,
  stepsUsedComputer,
} from "./agent-steps";

const step = (...toolNames: string[]) => ({
  toolCalls: toolNames.map((toolName) => ({ toolName })),
});

describe("agent step budgets", () => {
  test("the default stays small; computer work may run longer", () => {
    expect(DEFAULT_AGENT_STEPS).toBe(10);
    expect(COMPUTER_AGENT_STEPS).toBe(30);
  });
});

describe("stepsUsedComputer", () => {
  test("false until computer appears", () => {
    expect(stepsUsedComputer([])).toBe(false);
    expect(stepsUsedComputer([step("graphql_query")])).toBe(false);
  });

  test("true once any step called computer", () => {
    expect(stepsUsedComputer([step("computer")])).toBe(true);
    expect(
      stepsUsedComputer([
        step("graphql_query"),
        step("computer", "recall_memory"),
      ]),
    ).toBe(true);
  });

  test("exec on the parent does not raise the budget — it has no exec", () => {
    expect(stepsUsedComputer([step("exec")])).toBe(false);
  });
});

describe("computerAwareStepLimit", () => {
  test("stops at the default when computer was never called", () => {
    const steps = Array.from({ length: DEFAULT_AGENT_STEPS }, () =>
      step("graphql_query"),
    );
    expect(computerAwareStepLimit({ steps: steps.slice(0, 9) })).toBe(false);
    expect(computerAwareStepLimit({ steps })).toBe(true);
  });

  test("keeps going past the default once computer has been called", () => {
    const steps = [
      step("computer"),
      ...Array.from({ length: DEFAULT_AGENT_STEPS }, () => step("computer")),
    ];
    expect(steps.length).toBeGreaterThan(DEFAULT_AGENT_STEPS);
    expect(computerAwareStepLimit({ steps })).toBe(false);
  });

  test("stops at the computer-turn cap", () => {
    const steps = Array.from({ length: COMPUTER_AGENT_STEPS }, () =>
      step("computer"),
    );
    expect(computerAwareStepLimit({ steps: steps.slice(0, 29) })).toBe(false);
    expect(computerAwareStepLimit({ steps })).toBe(true);
  });

  test("raising the cap on the last default step still allows more", () => {
    const steps = [
      ...Array.from({ length: DEFAULT_AGENT_STEPS - 1 }, () =>
        step("graphql_query"),
      ),
      step("computer"),
    ];
    expect(steps).toHaveLength(DEFAULT_AGENT_STEPS);
    expect(computerAwareStepLimit({ steps })).toBe(false);
  });
});
