import { describe, expect, test } from "bun:test";
import {
  GITHUB_AGENT_SYSTEM,
  GITHUB_QUERY_DESCRIPTION,
  GITHUB_TOOL_DESCRIPTION,
} from "./github-prompt";

describe("GITHUB_TOOL_DESCRIPTION", () => {
  test("lists only the lookups the github sub-agent can actually do", () => {
    expect(GITHUB_TOOL_DESCRIPTION).toContain("org or user overview");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("list repos");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("repo details");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("list issues");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("list pull requests");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("msocietyhq");
  });

  test("tells the parent not to send github work the sub-agent cannot do", () => {
    expect(GITHUB_TOOL_DESCRIPTION).toContain("cannot");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("gh");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("clone");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("file");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("CI");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("create");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("do not call github");
  });

  test("tells the parent not to use computer or gh for those lookups", () => {
    expect(GITHUB_TOOL_DESCRIPTION).toContain("not computer");
    expect(GITHUB_TOOL_DESCRIPTION).toContain("not gh");
  });
});

describe("GITHUB_QUERY_DESCRIPTION", () => {
  test("names the five lookups, not a free-form GitHub task", () => {
    expect(GITHUB_QUERY_DESCRIPTION).toContain("org or user");
    expect(GITHUB_QUERY_DESCRIPTION).toContain("repos");
    expect(GITHUB_QUERY_DESCRIPTION).toContain("issues");
    expect(GITHUB_QUERY_DESCRIPTION).toContain("pull requests");
  });
});

describe("GITHUB_AGENT_SYSTEM", () => {
  test("lists the five tools and refuses everything else", () => {
    expect(GITHUB_AGENT_SYSTEM).toContain("get_github_org");
    expect(GITHUB_AGENT_SYSTEM).toContain("list_github_repos");
    expect(GITHUB_AGENT_SYSTEM).toContain("get_github_repo");
    expect(GITHUB_AGENT_SYSTEM).toContain("list_github_issues");
    expect(GITHUB_AGENT_SYSTEM).toContain("list_github_prs");
    expect(GITHUB_AGENT_SYSTEM).toContain("cannot");
    expect(GITHUB_AGENT_SYSTEM).toContain("gh");
    expect(GITHUB_AGENT_SYSTEM).toContain("do not guess");
  });
});
