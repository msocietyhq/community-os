import { describe, expect, test } from "bun:test";
import {
  COMPUTER_AGENT_SYSTEM,
  COMPUTER_QUERY_DESCRIPTION,
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

  test("tells the parent the sub-agent cannot see this conversation", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("cannot see this conversation");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("all relevant context");
  });

  test("tells the parent to inspect and verify by delegating again, not with exec", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("verification");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("another computer briefing");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("do not keep re-checking");
    expect(COMPUTER_TOOL_DESCRIPTION).not.toContain("with exec");
  });

  test("tells the parent that git work never lands on main, and to pack the branch", () => {
    expect(COMPUTER_TOOL_DESCRIPTION).toContain(
      "never commits to main or master",
    );
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("draft PR on the first push");
    expect(COMPUTER_TOOL_DESCRIPTION).toContain("pack the branch");
  });
});

describe("COMPUTER_QUERY_DESCRIPTION", () => {
  test("requires a self-contained briefing", () => {
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("self-contained");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("only this string");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("outcome");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("constraints");
    expect(COMPUTER_QUERY_DESCRIPTION).toContain("git branch");
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

  test("reports evidence the parent can use for a computer verification pass", () => {
    expect(COMPUTER_AGENT_SYSTEM).toContain("evidence it succeeded");
    expect(COMPUTER_AGENT_SYSTEM).toContain("verification pass");
    expect(COMPUTER_AGENT_SYSTEM).not.toContain("verify with exec");
  });

  test("never commits to main or master; branches, conventional-commits, and opens a draft PR", () => {
    expect(COMPUTER_AGENT_SYSTEM).toContain("never commit to main or master");
    expect(COMPUTER_AGENT_SYSTEM).toContain("branch the briefing named");
    expect(COMPUTER_AGENT_SYSTEM).toContain("conventional commits");
    expect(COMPUTER_AGENT_SYSTEM).toContain("each logical juncture");
    expect(COMPUTER_AGENT_SYSTEM).toContain("draft pull request");
    expect(COMPUTER_AGENT_SYSTEM).toContain("first push");
  });
});

describe("COMPUTER_AGENT_STEPS", () => {
  test("the computer sub-agent gets the larger budget", () => {
    expect(COMPUTER_AGENT_STEPS).toBe(30);
  });
});
