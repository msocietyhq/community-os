import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";

const GITHUB_API = "https://api.github.com";
const DEFAULT_ORG = "msocietyhq";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

async function githubFetch(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const response = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

const githubTools = {
  get_github_org: tool({
    description: "Get overview of a GitHub organization or user: description, repo count, website, followers",
    inputSchema: z.object({
      owner: z
        .string()
        .optional()
        .describe(`GitHub org or username (default: ${DEFAULT_ORG})`),
    }),
    execute: async ({ owner = DEFAULT_ORG }) => {
      // Try org first, fall back to user
      try {
        return await githubFetch(`/orgs/${owner}`);
      } catch {
        return githubFetch(`/users/${owner}`);
      }
    },
  }),

  list_github_repos: tool({
    description: "List public repositories for a GitHub org or user",
    inputSchema: z.object({
      owner: z
        .string()
        .optional()
        .describe(`GitHub org or username (default: ${DEFAULT_ORG})`),
      sort: z
        .enum(["created", "updated", "pushed", "full_name"])
        .optional()
        .describe("Sort order (default: updated)"),
      per_page: z
        .number()
        .optional()
        .describe("Number of repos to return (default: 10, max: 30)"),
    }),
    execute: async ({ owner = DEFAULT_ORG, sort = "updated", per_page = 10 }) => {
      const limit = Math.min(per_page, 30);
      // Works for both orgs and users
      try {
        return await githubFetch(`/orgs/${owner}/repos?sort=${sort}&per_page=${limit}&type=public`);
      } catch {
        return githubFetch(`/users/${owner}/repos?sort=${sort}&per_page=${limit}&type=public`);
      }
    },
  }),

  get_github_repo: tool({
    description: "Get details of any public GitHub repository: stars, open issues, language, topics, description",
    inputSchema: z.object({
      owner: z
        .string()
        .optional()
        .describe(`Repository owner (org or username, default: ${DEFAULT_ORG})`),
      repo: z.string().describe("Repository name (e.g. 'community-os')"),
    }),
    execute: async ({ owner = DEFAULT_ORG, repo }) => {
      return githubFetch(`/repos/${owner}/${repo}`);
    },
  }),

  list_github_issues: tool({
    description: "List issues for any public GitHub repository",
    inputSchema: z.object({
      owner: z
        .string()
        .optional()
        .describe(`Repository owner (org or username, default: ${DEFAULT_ORG})`),
      repo: z.string().describe("Repository name"),
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Issue state (default: open)"),
      per_page: z
        .number()
        .optional()
        .describe("Number of issues to return (default: 10, max: 30)"),
    }),
    execute: async ({ owner = DEFAULT_ORG, repo, state = "open", per_page = 10 }) => {
      const limit = Math.min(per_page, 30);
      return githubFetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`);
    },
  }),

  list_github_prs: tool({
    description: "List pull requests for any public GitHub repository",
    inputSchema: z.object({
      owner: z
        .string()
        .optional()
        .describe(`Repository owner (org or username, default: ${DEFAULT_ORG})`),
      repo: z.string().describe("Repository name"),
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("PR state (default: open)"),
      per_page: z
        .number()
        .optional()
        .describe("Number of PRs to return (default: 10, max: 30)"),
    }),
    execute: async ({ owner = DEFAULT_ORG, repo, state = "open", per_page = 10 }) => {
      const limit = Math.min(per_page, 30);
      return githubFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}`);
    },
  }),
};

export async function runGithubAgent(query: string): Promise<string> {
  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: `You are a GitHub assistant. You can browse any public GitHub repository, org, or user.
The MSOCIETY community's default org is ${DEFAULT_ORG} — use it when no owner is specified.
Be concise. Format for Telegram Markdown. Present lists as compact one-liners.`,
    messages: [{ role: "user", content: query }],
    tools: githubTools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 512,
  });

  return result.text || "No GitHub information found.";
}
