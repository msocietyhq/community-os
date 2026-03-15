import { tool } from "ai";
import { z } from "zod";
import type { treaty } from "@elysiajs/eden";
import type { App } from "../../app";

export interface ToolContext {
  api: ReturnType<typeof treaty<App>>;
}

export function createTools(ctx: ToolContext) {
  return {
    list_events: tool({
      description: "List upcoming or past community events",
      inputSchema: z.object({
        status: z
          .enum(["published", "completed", "cancelled"])
          .optional()
          .describe("Filter by event status"),
        limit: z
          .number()
          .optional()
          .describe("Number of events to return (default: 5)"),
      }),
      execute: async ({ status, limit }) => {
        const { data, error } = await ctx.api.api.v1.events.get({
          query: { status, page: 1, limit: limit ?? 5 },
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_event: tool({
      description: "Get details of a specific event including attendees",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID or slug"),
      }),
      execute: async ({ event_id }) => {
        const { data, error } = await ctx.api.api.v1.events({ id: event_id }).get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    rsvp_event: tool({
      description: "RSVP to an event for the requesting user",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID or slug"),
        status: z
          .enum(["going", "maybe", "not_going"])
          .describe("RSVP status"),
      }),
      execute: async ({ event_id, status }) => {
        const { data, error } = await ctx.api.api.v1.events({ id: event_id }).rsvp.post({
          rsvpStatus: status,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    list_projects: tool({
      description: "List community projects",
      inputSchema: z.object({
        status: z
          .enum(["active", "paused", "archived"])
          .optional()
          .describe("Filter by project status"),
      }),
      execute: async () => {
        const { data, error } = await ctx.api.api.v1.projects.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_member_profile: tool({
      description: "Get a community member's profile",
      inputSchema: z.object({
        user_id: z.string().describe("The user ID of the member"),
      }),
      execute: async () => {
        const { data, error } = await ctx.api.api.v1.members.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    update_my_profile: tool({
      description: "Update the requesting user's own profile",
      inputSchema: z.object({
        bio: z.string().optional().describe("Short bio"),
        skills: z.array(z.string()).optional().describe("List of skills"),
        interests: z
          .array(z.string())
          .optional()
          .describe("List of interests"),
        current_company: z
          .string()
          .optional()
          .describe("Current company"),
        current_title: z
          .string()
          .optional()
          .describe("Current job title"),
      }),
      execute: async ({
        bio,
        skills,
        interests,
        current_company,
        current_title,
      }) => {
        const { data, error } = await ctx.api.api.v1.members.me.patch({
          bio,
          skills,
          interests,
          currentCompany: current_company,
          currentTitle: current_title,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_my_profile: tool({
      description: "Get the requesting user's own community profile",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await ctx.api.api.v1.members.me.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_my_reputation: tool({
      description: "Get the requesting user's reputation score",
      inputSchema: z.object({}),
      execute: async () => {
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
        const { data, error } = await ctx.api.api.v1.reputation.leaderboard.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_fund_overview: tool({
      description: "Get community fund summary. Only available to admins.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await ctx.api.api.v1.funds.overview.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    get_my_balance: tool({
      description:
        "Get what the community owes the requesting user or vice versa",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await ctx.api.api.v1.funds.balances.get();
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),
  };
}
