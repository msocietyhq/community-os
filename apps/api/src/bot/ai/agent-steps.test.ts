import { describe, expect, test } from "bun:test";
import { COMPUTER_AGENT_STEPS, DEFAULT_AGENT_STEPS } from "./agent-steps";

describe("agent step budgets", () => {
  test("the parent stays small; the computer sub-agent may run longer", () => {
    expect(DEFAULT_AGENT_STEPS).toBe(10);
    expect(COMPUTER_AGENT_STEPS).toBe(30);
  });
});
