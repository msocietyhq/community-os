import { describe, expect, test } from "bun:test";
import {
  COMPUTER_AGENT_SYSTEM,
  COMPUTER_TOOL_DESCRIPTION,
} from "./computer-prompt";
import { COMPUTER_AGENT_STEPS } from "../agent-steps";

describe("COMPUTER_TOOL_DESCRIPTION", () => {
  test("tells the parent to delegate a task, not a command", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("Delegate a task");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("until the work is finished");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("not the commands");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("delegate again");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("check back later");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("10 minutes");
  });
});

describe("COMPUTER_AGENT_SYSTEM", () => {
  test("tells the sub-agent to keep going until the task is verified", () => {
    expect(COMPUTER_AGENT_SYSTEM).toContain(
      "until that task is done and you have checked that it worked",
    );
    expect(COMPUTER_AGENT_SYSTEM).toContain("fresh shell");
    expect(COMPUTER_AGENT_SYSTEM).toContain("no polling");
    expect(COMPUTER_AGENT_SYSTEM).toContain("check back later");
    expect(COMPUTER_AGENT_SYSTEM).toContain("10 minutes");
  });
});

describe("COMPUTER_AGENT_STEPS", () => {
  test("the computer sub-agent gets the larger budget", () => {
    expect(COMPUTER_AGENT_STEPS).toBe(30);
  });
});
