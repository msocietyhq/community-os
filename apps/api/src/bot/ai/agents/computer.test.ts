import { describe, expect, test } from "bun:test";
import {
  COMPUTER_AGENT_SYSTEM,
  COMPUTER_QUERY_DESCRIPTION,
  COMPUTER_TOOL_DESCRIPTION,
  PARENT_EXEC_TOOL_DESCRIPTION,
  PARENT_VERIFY_ASK,
  withParentVerifyAsk,
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

  test("tells the parent the sub-agent cannot see this conversation", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("cannot see this conversation");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("all relevant context");
  });

  test("tells the parent to verify the report with exec", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("verify");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("exec");
  });
});

describe("COMPUTER_QUERY_DESCRIPTION", () => {
  test("requires a self-contained briefing", () => {
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("self-contained");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("only this string");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("outcome");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("constraints");
  });
});

describe("PARENT_EXEC_TOOL_DESCRIPTION", () => {
  test("is for inspecting and verifying, not carrying out the task", () => {
    expect(PARENT_EXEC_TOOL_DESCRIPTION).toContain("inspect");
    expect(PARENT_EXEC_TOOL_DESCRIPTION).toContain("verify");
    expect(PARENT_EXEC_TOOL_DESCRIPTION).toContain("computer");
    expect(PARENT_EXEC_TOOL_DESCRIPTION).toContain("multi-step");
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

  test("tells the sub-agent it only has the parent's briefing", () => {
    expect(COMPUTER_AGENT_SYSTEM).toContain("only the briefing");
    expect(COMPUTER_AGENT_SYSTEM).toContain("unstated");
  });

  test("tells the sub-agent to ask the parent to verify with exec", () => {
    expect(COMPUTER_AGENT_SYSTEM).toContain(
      "ask the parent to verify with exec",
    );
    expect(COMPUTER_AGENT_SYSTEM).toContain("what to check");
  });
});

describe("withParentVerifyAsk", () => {
  test("appends the ask when the report omitted it", () => {
    const out = withParentVerifyAsk("Installed nginx.");
    expect(out).toContain("Installed nginx.");
    expect(out).toContain(PARENT_VERIFY_ASK);
  });

  test("does not duplicate the ask", () => {
    const once = withParentVerifyAsk("Done.\n\nPlease verify this with exec.");
    expect(once.match(/verify this with exec/g)?.length).toBe(1);
  });
});

describe("COMPUTER_AGENT_STEPS", () => {
  test("the computer sub-agent gets the larger budget", () => {
    expect(COMPUTER_AGENT_STEPS).toBe(30);
  });
});
