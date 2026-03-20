import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import { schemaSDL } from "../../../graphql";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createEventsAgent(ctx: ToolContext) {
  const eventsTools = {
    graphql_query: tool({
      description:
        "Query community events via GraphQL. Write a GraphQL query selecting only the fields you need.",
      inputSchema: z.object({
        query: z.string().describe("GraphQL query string"),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("GraphQL variables"),
      }),
      execute: async ({ query, variables }) => {
        console.log("[events-agent:graphql_query]", query.slice(0, 120));
        return ctx.graphql(query, variables);
      },
    }),

    rsvp_event: tool({
      description: "RSVP to an event for the requesting user",
      inputSchema: z.object({
        event_id: z
          .string()
          .describe("The event ID (UUID) or slug"),
        status: z
          .enum(["going", "maybe", "not_going"])
          .describe("RSVP status"),
      }),
      execute: async ({ event_id, status }) => {
        console.log("[events-agent:rsvp_event]", { event_id, status });
        const { data, error } = await ctx.api.api.v1
          .events({ id: event_id })
          .rsvp.post({ rsvpStatus: status });
        if (error) {
          console.error("[events-agent:rsvp_event] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    create_event: tool({
      description: "Create a new community event. Only available to admins.",
      inputSchema: z.object({
        title: z.string().describe("Event title"),
        description: z.string().optional().describe("Event description"),
        event_type: z
          .enum(["meetup", "workshop", "hackathon", "talk", "social", "other"])
          .describe("Type of event"),
        venue_id: z.string().optional().describe("Venue ID to host the event at"),
        is_online: z.boolean().default(false).describe("Whether the event is online"),
        online_url: z.string().optional().describe("URL for online event"),
        starts_at: z.string().describe("Start date/time in ISO 8601 format"),
        ends_at: z.string().optional().describe("End date/time in ISO 8601 format"),
        max_attendees: z.number().optional().describe("Maximum number of attendees"),
      }),
      execute: async ({
        title, description, event_type, venue_id, is_online, online_url,
        starts_at, ends_at, max_attendees,
      }) => {
        console.log("[events-agent:create_event]", { title, event_type, starts_at });
        const { data, error } = await ctx.api.api.v1.events.post({
          title, description, eventType: event_type, venueId: venue_id,
          isOnline: is_online, onlineUrl: online_url, startsAt: starts_at,
          endsAt: ends_at, maxAttendees: max_attendees,
        });
        if (error) {
          console.error("[events-agent:create_event] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    update_event: tool({
      description: "Update an existing event. Only available to admins.",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID (UUID) or slug"),
        title: z.string().optional().describe("Event title"),
        description: z.string().optional().describe("Event description"),
        event_type: z
          .enum(["meetup", "workshop", "hackathon", "talk", "social", "other"])
          .optional()
          .describe("Type of event"),
        venue_id: z.string().optional().describe("Venue ID"),
        is_online: z.boolean().optional().describe("Whether the event is online"),
        online_url: z.string().optional().describe("URL for online event"),
        starts_at: z.string().optional().describe("Start date/time in ISO 8601 format"),
        ends_at: z.string().optional().describe("End date/time in ISO 8601 format"),
        max_attendees: z.number().optional().describe("Maximum number of attendees"),
        status: z
          .enum(["draft", "published", "cancelled", "completed"])
          .optional()
          .describe("Event status"),
      }),
      execute: async ({
        event_id, title, description, event_type, venue_id, is_online,
        online_url, starts_at, ends_at, max_attendees, status,
      }) => {
        console.log("[events-agent:update_event]", { event_id, title, status });
        const { data, error } = await ctx.api.api.v1
          .events({ id: event_id })
          .patch({
            title, description, eventType: event_type, venueId: venue_id,
            isOnline: is_online, onlineUrl: online_url, startsAt: starts_at,
            endsAt: ends_at, maxAttendees: max_attendees, status,
          });
        if (error) {
          console.error("[events-agent:update_event] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    delete_event: tool({
      description: "Cancel/delete an event. Only available to admins.",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID (UUID) or slug"),
      }),
      execute: async ({ event_id }) => {
        console.log("[events-agent:delete_event]", { event_id });
        const { data, error } = await ctx.api.api.v1
          .events({ id: event_id })
          .delete();
        if (error) {
          console.error("[events-agent:delete_event] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),
  };

  return async function runEventsAgent(query: string): Promise<string> {
    console.log("[events-agent] query:", query);
    const today = new Date().toISOString().split("T")[0];
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: `You are an events assistant for the MSOCIETY community. Help with listing, viewing, RSVPing to, and managing events. Today's date is ${today}. Use ISO 8601 for dates. Only perform write operations (create/update/delete) when explicitly asked. Never repeat a write. Be concise, format for Telegram Markdown.

Always search by name/title before attempting updates. Use the graphql_query tool for reads. Paginate when hasNext is true.

## GraphQL Schema

${schemaSDL}`,
      messages: [{ role: "user", content: query }],
      tools: eventsTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[events-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No event information found.";
  };
}
