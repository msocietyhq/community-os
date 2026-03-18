import { tool } from "ai";
import { z } from "zod";
import type { treaty } from "@elysiajs/eden";
import type { App } from "../../app";
import {
  defineAbilityFor,
  type Actions,
  type Subjects,
} from "@community-os/shared/abilities";
import { isRole } from "@community-os/shared/constants";
import { runGithubAgent } from "./agents/github";
import { createEventsAgent } from "./agents/events";
import { createMembersAgent } from "./agents/members";
import { createVenuesAgent } from "./agents/venues";

export interface ToolContext {
  api: ReturnType<typeof treaty<App>>;
}

export function createTools(ctx: ToolContext) {
  const runEventsAgent = createEventsAgent(ctx);
  const runMembersAgent = createMembersAgent(ctx);
  const runVenuesAgent = createVenuesAgent(ctx);

  return {
    events: tool({
      description:
        "Look up or manage community events: list upcoming events, get event details, RSVP, or create/update/delete events (admin)",
      inputSchema: z.object({
        query: z.string().describe("What to look up or do with events"),
      }),
      execute: async ({ query }) => {
        console.log("[main-agent] → events sub-agent, query:", query);
        const result = await runEventsAgent(query);
        console.log("[main-agent] ← events sub-agent, response:", result.slice(0, 120));
        return result;
      },
    }),

    members: tool({
      description:
        "Find or manage community members: search by skills/interests, view profiles, update your own profile, or check reputation scores",
      inputSchema: z.object({
        query: z.string().describe("What to look up or do with members"),
      }),
      execute: async ({ query }) => {
        console.log("[main-agent] → members sub-agent, query:", query);
        const result = await runMembersAgent(query);
        console.log("[main-agent] ← members sub-agent, response:", result.slice(0, 120));
        return result;
      },
    }),

    venues: tool({
      description:
        "Look up or manage community venues: list venues, get details, or create/update/delete venues (admin)",
      inputSchema: z.object({
        query: z.string().describe("What to look up or do with venues"),
      }),
      execute: async ({ query }) => {
        console.log("[main-agent] → venues sub-agent, query:", query);
        const result = await runVenuesAgent(query);
        console.log("[main-agent] ← venues sub-agent, response:", result.slice(0, 120));
        return result;
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

    github: tool({
      description:
        "Browse any public GitHub repo, org, or user: list repos, get repo details, view issues and pull requests. Defaults to the `msocietyhq` org when no owner is specified.",
      inputSchema: z.object({
        query: z.string().describe("What to look up on GitHub"),
      }),
      execute: async ({ query }) => {
        return runGithubAgent(query);
      },
    }),

    check_permissions: tool({
      description:
        "Check if the current user has permission to perform an action. Use this before attempting any write or admin operation.",
      inputSchema: z.object({
        action: z.enum([
          "create",
          "read",
          "update",
          "delete",
          "rsvp",
          "check_in",
          "endorse",
          "provision",
          "deprovision",
          "ban",
          "manage_role",
        ]),
        subject: z.enum([
          "Event",
          "Member",
          "Project",
          "Venue",
          "Fund",
          "Reputation",
          "Infra",
          "Audit",
        ]),
      }),
      execute: async ({ action, subject }) => {
        const { data, error } = await ctx.api.api.v1.members.me.get();
        if (error)
          return { allowed: false, reason: "Could not retrieve user profile" };

        const { id, role } = data.user;
        if (!isRole(role))
          return { allowed: false, reason: "Unrecognized user role" };
        const ability = defineAbilityFor({ id, role });

        let subjectArg: Subjects;
        if (subject === "Member") {
          subjectArg = {
            __caslSubjectType__: "Member",
            userId: id,
          } as Subjects;
        } else if (subject === "Project") {
          subjectArg = {
            __caslSubjectType__: "Project",
            ownerId: id,
          } as Subjects;
        } else {
          subjectArg = subject;
        }

        const allowed = ability.can(action as Actions, subjectArg);
        return { allowed, role };
      },
    }),
  };
}
