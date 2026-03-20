import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import { schemaSDL } from "../../../graphql";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createMembersAgent(ctx: ToolContext) {
  const membersTools = {
    graphql_query: tool({
      description:
        "Query community members via GraphQL. Write a GraphQL query selecting only the fields you need.",
      inputSchema: z.object({
        query: z.string().describe("GraphQL query string"),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("GraphQL variables"),
      }),
      execute: async ({ query, variables }) => {
        console.log("[members-agent:graphql_query]", query.slice(0, 120));
        return ctx.graphql(query, variables);
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
        linkedin_url: z.string().url().optional().describe("LinkedIn profile URL"),
      }),
      execute: async ({
        bio, skills, interests, current_company, current_title,
        github, linkedin_url,
      }) => {
        console.log("[members-agent:update_my_profile]", {
          bio: bio?.slice(0, 40), skills, interests,
          current_company, current_title, github, linkedin_url,
        });
        const { data, error } = await ctx.api.api.v1.members.me.patch({
          bio, skills, interests, currentCompany: current_company,
          currentTitle: current_title, githubHandle: github,
          linkedinUrl: linkedin_url,
        });
        if (error) {
          console.error("[members-agent:update_my_profile] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    get_my_profile: tool({
      description: "Get the requesting user's own community profile",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[members-agent:get_my_profile]");
        const { data, error } = await ctx.api.api.v1.members.me.get();
        if (error) {
          console.error("[members-agent:get_my_profile] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    get_my_reputation: tool({
      description: "Get the requesting user's reputation score and recent events",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[members-agent:get_my_reputation]");
        const { data: me, error: meErr } = await ctx.api.api.v1.members.me.get();
        if (meErr) return { status: meErr.status, value: meErr.value };
        const { data, error } = await ctx.api.api.v1
          .reputation({ userId: me.user.id })
          .get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_reputation: tool({
      description:
        "Get any community member's reputation score and recent events by their user ID",
      inputSchema: z.object({
        user_id: z.string().describe("The user ID of the member"),
      }),
      execute: async ({ user_id }) => {
        console.log("[members-agent:get_reputation]", { user_id });
        const { data, error } = await ctx.api.api.v1
          .reputation({ userId: user_id })
          .get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_leaderboard: tool({
      description: "Get the top reputation scores in the community",
      inputSchema: z.object({
        limit: z.number().optional().describe("Number of entries to return (default: 10)"),
      }),
      execute: async () => {
        console.log("[members-agent:get_leaderboard]");
        const { data, error } = await ctx.api.api.v1.reputation.leaderboard.get();
        if (error) {
          console.error("[members-agent:get_leaderboard] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),
  };

  return async function runMembersAgent(query: string): Promise<string> {
    console.log("[members-agent] query:", query);
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: `You are a members assistant for the MSOCIETY community. Help with finding members, viewing profiles, updating the user's own profile, and checking reputation scores. Be concise, format for Telegram Markdown.

Use the graphql_query tool for searching/browsing members. Use get_my_profile for the user's own profile. Paginate when hasNext is true.

## GraphQL Schema

${schemaSDL}`,
      messages: [{ role: "user", content: query }],
      tools: membersTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[members-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No member information found.";
  };
}
