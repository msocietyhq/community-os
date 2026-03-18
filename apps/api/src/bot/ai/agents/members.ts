import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createMembersAgent(ctx: ToolContext) {
  const membersTools = {
    get_member_profile: tool({
      description: "Get a community member's profile by their user ID",
      inputSchema: z.object({
        user_id: z.string().describe("The user ID of the member"),
      }),
      execute: async ({ user_id }) => {
        console.log("[members-agent:get_member_profile]", { user_id });
        const { data, error } = await ctx.api.api.v1
          .members({ userId: user_id })
          .get();
        if (error) { console.error("[members-agent:get_member_profile] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    search_members: tool({
      description:
        "Search for community members by name, skills, interests, bio, title, company, education, github handle, or telegram username",
      inputSchema: z.object({
        q: z
          .string()
          .optional()
          .describe("Free-text search across name, bio, title, company, etc."),
        skills: z
          .array(z.string())
          .optional()
          .describe("Filter by skills (e.g. ['python', 'react'])"),
        interests: z
          .array(z.string())
          .optional()
          .describe("Filter by interests (e.g. ['ai', 'web3'])"),
        role: z
          .string()
          .optional()
          .describe("Filter by role (e.g. 'admin', 'member')"),
        limit: z
          .number()
          .optional()
          .describe("Number of results to return (default: 20)"),
      }),
      execute: async ({ q, skills, interests, role, limit }) => {
        console.log("[members-agent:search_members]", { q, skills, interests, role, limit });
        const { data, error } = await ctx.api.api.v1.members.get({
          query: {
            q,
            role,
            skills: skills?.join(",") as string | undefined,
            interests: interests?.join(",") as string | undefined,
            page: 1,
            limit: limit ?? 20,
          },
        });
        if (error) { console.error("[members-agent:search_members] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        console.log("[members-agent:search_members] returned", Array.isArray(data) ? data.length : 1, "item(s)");
        return data;
      },
    }),

    update_my_profile: tool({
      description: "Update the requesting user's own profile",
      inputSchema: z.object({
        bio: z.string().optional().describe("Short bio"),
        skills: z.array(z.string()).optional().describe("List of skills"),
        interests: z.array(z.string()).optional().describe("List of interests"),
        current_company: z.string().optional().describe("Current company"),
        current_title: z.string().optional().describe("Current job title"),
        github: z.string().optional().describe("GitHub username (without @)"),
      }),
      execute: async ({
        bio,
        skills,
        interests,
        current_company,
        current_title,
        github,
      }) => {
        console.log("[members-agent:update_my_profile]", { bio: bio?.slice(0, 40), skills, interests, current_company, current_title, github });
        const { data, error } = await ctx.api.api.v1.members.me.patch({
          bio,
          skills,
          interests,
          currentCompany: current_company,
          currentTitle: current_title,
          githubHandle: github,
        });
        if (error) { console.error("[members-agent:update_my_profile] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    get_my_profile: tool({
      description: "Get the requesting user's own community profile",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[members-agent:get_my_profile]");
        const { data, error } = await ctx.api.api.v1.members.me.get();
        if (error) { console.error("[members-agent:get_my_profile] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    get_my_reputation: tool({
      description: "Get the requesting user's reputation score",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[members-agent:get_my_reputation]");
        return { message: "Reputation feature is not yet available." };
      },
    }),

    get_leaderboard: tool({
      description: "Get the top reputation scores in the community",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Number of entries to return (default: 10)"),
      }),
      execute: async () => {
        console.log("[members-agent:get_leaderboard]");
        const { data, error } =
          await ctx.api.api.v1.reputation.leaderboard.get();
        if (error) { console.error("[members-agent:get_leaderboard] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),
  };

  return async function runMembersAgent(query: string): Promise<string> {
    console.log("[members-agent] query:", query);
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: `You are a members assistant for the MSOCIETY community. Help with finding members, viewing profiles, updating the user's own profile, and checking reputation scores. Be concise, format for Telegram Markdown.`,
      messages: [{ role: "user", content: query }],
      tools: membersTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[members-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No member information found.";
  };
}
