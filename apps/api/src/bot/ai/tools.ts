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
        title,
        description,
        event_type,
        venue_id,
        is_online,
        online_url,
        starts_at,
        ends_at,
        max_attendees,
      }) => {
        const { data, error } = await ctx.api.api.v1.events.post({
          title,
          description,
          eventType: event_type,
          venueId: venue_id,
          isOnline: is_online,
          onlineUrl: online_url,
          startsAt: starts_at,
          endsAt: ends_at,
          maxAttendees: max_attendees,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    update_event: tool({
      description: "Update an existing event. Only available to admins.",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID"),
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
        event_id,
        title,
        description,
        event_type,
        venue_id,
        is_online,
        online_url,
        starts_at,
        ends_at,
        max_attendees,
        status,
      }) => {
        const { data, error } = await ctx.api.api.v1.events({ id: event_id }).patch({
          title,
          description,
          eventType: event_type,
          venueId: venue_id,
          isOnline: is_online,
          onlineUrl: online_url,
          startsAt: starts_at,
          endsAt: ends_at,
          maxAttendees: max_attendees,
          status,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    delete_event: tool({
      description: "Cancel/delete an event. Only available to admins.",
      inputSchema: z.object({
        event_id: z.string().describe("The event ID"),
      }),
      execute: async ({ event_id }) => {
        const { data, error } = await ctx.api.api.v1.events({ id: event_id }).delete();
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
      description: "Get a community member's profile by their user ID",
      inputSchema: z.object({
        user_id: z.string().describe("The user ID of the member"),
      }),
      execute: async ({ user_id }) => {
        const { data, error } = await ctx.api.api.v1
          .members({ userId: user_id })
          .get();
        if (error) return { status: error.status, value: error.value };
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

    list_venues: tool({
      description: "List community venues/locations for events",
      inputSchema: z.object({
        q: z
          .string()
          .optional()
          .describe("Search by venue name or address"),
        limit: z
          .number()
          .optional()
          .describe("Number of venues to return (default: 20)"),
      }),
      execute: async ({ q, limit }) => {
        const { data, error } = await ctx.api.api.v1.venues.get({
          query: { q, page: 1, limit: limit ?? 20 },
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    create_venue: tool({
      description: "Create a new venue/location. Only available to admins.",
      inputSchema: z.object({
        name: z.string().describe("Venue name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        country: z.string().optional().describe("2-letter country code (e.g. 'AE')"),
        postal_code: z.string().optional().describe("Postal/ZIP code"),
        maps_url: z.string().optional().describe("Google Maps or similar URL"),
        capacity: z.number().optional().describe("Maximum capacity"),
        cost_per_day: z.number().optional().describe("Cost per day in base currency"),
        cost_notes: z.string().optional().describe("Notes about cost (e.g. discounts)"),
        notes: z.string().optional().describe("General notes about the venue"),
      }),
      execute: async ({
        name,
        address,
        city,
        country,
        postal_code,
        maps_url,
        capacity,
        cost_per_day,
        cost_notes,
        notes,
      }) => {
        const { data, error } = await ctx.api.api.v1.venues.post({
          name,
          address,
          city,
          country,
          postalCode: postal_code,
          mapsUrl: maps_url,
          capacity,
          costPerDay: cost_per_day,
          costNotes: cost_notes,
          notes,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    update_venue: tool({
      description: "Update an existing venue. Only available to admins.",
      inputSchema: z.object({
        venue_id: z.string().describe("The venue ID"),
        name: z.string().optional().describe("Venue name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        country: z.string().optional().describe("2-letter country code"),
        postal_code: z.string().optional().describe("Postal/ZIP code"),
        maps_url: z.string().optional().describe("Google Maps or similar URL"),
        capacity: z.number().optional().describe("Maximum capacity"),
        cost_per_day: z.number().optional().describe("Cost per day in base currency"),
        cost_notes: z.string().optional().describe("Notes about cost"),
        notes: z.string().optional().describe("General notes about the venue"),
      }),
      execute: async ({
        venue_id,
        name,
        address,
        city,
        country,
        postal_code,
        maps_url,
        capacity,
        cost_per_day,
        cost_notes,
        notes,
      }) => {
        const { data, error } = await ctx.api.api.v1.venues({ id: venue_id }).patch({
          name,
          address,
          city,
          country,
          postalCode: postal_code,
          mapsUrl: maps_url,
          capacity,
          costPerDay: cost_per_day,
          costNotes: cost_notes,
          notes,
        });
        if (error) return { status: error.status, value: error.value };
        return data;
      },
    }),

    delete_venue: tool({
      description: "Delete a venue. Only available to admins.",
      inputSchema: z.object({
        venue_id: z.string().describe("The venue ID"),
      }),
      execute: async ({ venue_id }) => {
        const { data, error } = await ctx.api.api.v1.venues({ id: venue_id }).delete();
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
