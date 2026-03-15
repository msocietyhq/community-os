import { tool } from "ai";
import { z } from "zod";
import { eventsService } from "../../services/events.service";
import { membersService } from "../../services/members.service";
import { AppError } from "../../lib/errors";

export interface ToolContext {
  userId: string;
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
        try {
          return await eventsService.list(
            { status, page: 1, limit: limit ?? 5 },
            "member",
          );
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
      },
    }),

    get_event: tool({
      description: "Get details of a specific event including attendees",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID or slug"),
      }),
      execute: async ({ event_id }) => {
        try {
          return await eventsService.getById(event_id);
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
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
        try {
          return await eventsService.rsvp(event_id, ctx.userId, status);
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
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
        return { message: "Projects feature is not yet available." };
      },
    }),

    get_member_profile: tool({
      description: "Get a community member's profile",
      inputSchema: z.object({
        user_id: z.string().describe("The user ID of the member"),
      }),
      execute: async ({ user_id }) => {
        try {
          const member = await membersService.findByUserId(user_id);
          if (!member) return { error: "Member not found." };
          return member;
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
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
        try {
          const updated = await membersService.update(ctx.userId, {
            bio,
            skills,
            interests,
            currentCompany: current_company,
            currentTitle: current_title,
          });
          if (!updated) return { error: "Profile not found." };
          return updated;
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
      },
    }),

    get_my_profile: tool({
      description: "Get the requesting user's own community profile",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const member = await membersService.findByUserId(ctx.userId);
          if (!member) return { error: "You don't have a profile yet." };
          return member;
        } catch (e) {
          if (e instanceof AppError) return { error: e.message };
          return { error: "Something went wrong." };
        }
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
        return { message: "Leaderboard feature is not yet available." };
      },
    }),

    get_fund_overview: tool({
      description: "Get community fund summary. Only available to admins.",
      inputSchema: z.object({}),
      execute: async () => {
        return { message: "Fund overview feature is not yet available." };
      },
    }),

    get_my_balance: tool({
      description:
        "Get what the community owes the requesting user or vice versa",
      inputSchema: z.object({}),
      execute: async () => {
        return { message: "Balance feature is not yet available." };
      },
    }),
  };
}
