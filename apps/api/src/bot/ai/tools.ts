import { tool } from "ai";
import { z } from "zod";
import type { treaty } from "@elysiajs/eden";
import type { App } from "../../app";
import { env } from "../../env";
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
import { createProjectsAgent } from "./agents/projects";
import { searchMessagesHybrid } from "../../services/messages.service";
import { getRecentChatMessages } from "../lib/telegram-message-logger";
import { formatGroupHistory } from "../lib/chat-context";
import {
  saveMemory,
  forgetMemoriesBySubject,
  forgetMemory,
} from "../../services/memory.service";

export interface ToolContext {
  api: ReturnType<typeof treaty<App>>;
  graphql: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
  chatId: string;
  senderTelegramId: number | null;
}

export function createTools(ctx: ToolContext) {
  const runEventsAgent = createEventsAgent(ctx);
  const runMembersAgent = createMembersAgent(ctx);
  const runVenuesAgent = createVenuesAgent(ctx);
  const runProjectsAgent = createProjectsAgent(ctx);

  return {
    graphql_query: tool({
      description:
        "Query community data via GraphQL. Write a GraphQL query selecting only the fields you need. Available types: events, projects, venues, members. Use for any read/search/list operation.",
      inputSchema: z.object({
        query: z.string().describe("GraphQL query string"),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("GraphQL variables"),
      }),
      execute: async ({ query, variables }) => {
        console.log("[main-agent:graphql_query]", query.slice(0, 120));
        return ctx.graphql(query, variables);
      },
    }),

    events: tool({
      description:
        "Look up or manage community events: list upcoming events, get event details, RSVP, or create/update/delete events (admin)",
      inputSchema: z.object({
        query: z.string().describe("What to look up or do with events"),
      }),
      execute: async ({ query }) => {
        console.log("[main-agent] → events sub-agent, query:", query);
        const result = await runEventsAgent(query);
        console.log(
          "[main-agent] ← events sub-agent, response:",
          result.slice(0, 120),
        );
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
        console.log(
          "[main-agent] ← members sub-agent, response:",
          result.slice(0, 120),
        );
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
        console.log(
          "[main-agent] ← venues sub-agent, response:",
          result.slice(0, 120),
        );
        return result;
      },
    }),

    projects: tool({
      description:
        "Look up or manage community projects: list, view details, create, update, delete projects, and manage project team members",
      inputSchema: z.object({
        query: z.string().describe("What to look up or do with projects"),
      }),
      execute: async ({ query }) => {
        console.log("[main-agent] → projects sub-agent, query:", query);
        const result = await runProjectsAgent(query);
        console.log(
          "[main-agent] ← projects sub-agent, response:",
          result.slice(0, 120),
        );
        return result;
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

    search_chat_history: tool({
      description:
        "Fetch or search past messages in the MSOCIETY Telegram group chat. Use with a `query` for semantic/keyword search (e.g. 'did anyone mention jobs?'). Omit `query` to fetch recent messages chronologically (e.g. 'what were we discussing?'). If using this to get context about a question or conversation, limit the date range to the last 6 hours.",
      inputSchema: z.object({
        chat_id: z
          .string()
          .default(env.TELEGRAM_GROUP_ID ?? "")
          .describe(
            "The Telegram chat ID — defaults to the main MSOCIETY group chat",
          ),
        query: z
          .string()
          .optional()
          .describe(
            "Natural-language search query. Omit to fetch recent messages chronologically.",
          ),
        after: z
          .string()
          .optional()
          .describe("ISO 8601 date — only return messages after this time"),
        before: z
          .string()
          .optional()
          .describe("ISO 8601 date — only return messages before this time"),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Number of messages to return (default: 20)"),
      }),
      execute: async ({ chat_id, query, after, before, limit }) => {
        console.log("[main-agent:search_chat_history]", {
          chat_id,
          query,
          after,
          before,
          limit,
        });

        const effectiveLimit = limit ?? 20;

        if (query) {
          const results = await searchMessagesHybrid(
            chat_id,
            query,
            effectiveLimit,
          );
          let filtered = results;
          if (after) {
            const afterDate = new Date(after);
            filtered = filtered.filter((r) => r.date >= afterDate);
          }
          if (before) {
            const beforeDate = new Date(before);
            filtered = filtered.filter((r) => r.date <= beforeDate);
          }
          if (filtered.length === 0) return { messages: [] };
          return {
            messages: filtered.map((r) => ({
              messageId: r.messageId,
              from: r.fromFirstName ?? r.fromUsername ?? "Unknown",
              text: r.text ?? r.caption,
              date: r.date.toISOString(),
              score: r.score,
            })),
          };
        }

        // No query — chronological fetch using date range as window
        const afterDate = after ? new Date(after) : null;
        const beforeDate = before ? new Date(before) : null;
        const windowMs = afterDate
          ? Date.now() - afterDate.getTime()
          : 7 * 24 * 60 * 60 * 1000; // default 7 days

        // Pass undefined for threadId so all threads are included
        const rows = await getRecentChatMessages(
          chat_id,
          undefined,
          windowMs,
          effectiveLimit,
        );
        let filtered = rows;
        if (beforeDate) {
          filtered = filtered.filter((r) => r.date <= beforeDate);
        }
        if (filtered.length === 0) return { messages: [] };
        const transcript = formatGroupHistory(filtered);
        return {
          transcript,
          messages: filtered.map((r) => ({
            messageId: r.messageId,
            from: r.fromFirstName ?? r.fromUsername ?? "Unknown",
            text: r.text ?? r.caption,
            date: r.date.toISOString(),
          })),
        };
      },
    }),

    save_memory: tool({
      description:
        "Save a noteworthy fact to long-term memory. Use when you learn something worth remembering about a person, the community, a decision, or an event.",
      inputSchema: z.object({
        content: z
          .string()
          .describe(
            "The fact to remember, as a standalone statement (e.g. 'Ali works at Stripe')",
          ),
        category: z
          .enum([
            "person_fact",
            "community_preference",
            "decision",
            "technical",
            "event_related",
            "general",
          ])
          .describe("Category of the memory"),
        subject: z
          .string()
          .describe("Who or what this fact is about"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .default(0.9)
          .describe("Confidence level 0-1 (default 0.9)"),
      }),
      execute: async ({ content, category, subject, confidence }) => {
        console.log("[main-agent:save_memory]", content);
        const result = await saveMemory({
          content,
          category,
          subject,
          subjectTelegramId: ctx.senderTelegramId,
          sourceChatId: ctx.chatId,
          confidence,
        });
        if (result.status === "skipped_duplicate") {
          return { saved: false, reason: "Duplicate memory already exists" };
        }
        return { saved: true, id: result.id, status: result.status };
      },
    }),

    forget_memory: tool({
      description:
        "Forget memories about a subject. Use when someone asks you to forget something about them or a topic.",
      inputSchema: z.object({
        subject: z
          .string()
          .describe("Who or what to forget about"),
        content_hint: z
          .string()
          .optional()
          .describe(
            "Optional keyword/phrase to narrow which memories to forget",
          ),
      }),
      execute: async ({ subject, content_hint }) => {
        console.log("[main-agent:forget_memory]", subject, content_hint);
        const count = await forgetMemoriesBySubject(subject, content_hint);
        return { forgotten: count };
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
