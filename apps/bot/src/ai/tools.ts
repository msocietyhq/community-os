import type Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Tool[] = [
  {
    name: "list_events",
    description: "List upcoming or past community events",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["published", "completed", "cancelled"],
          description: "Filter by event status",
        },
        limit: {
          type: "number",
          description: "Number of events to return (default: 5)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_event",
    description: "Get details of a specific event including attendees",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event ID or slug",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "rsvp_event",
    description: "RSVP to an event for the requesting user",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event ID or slug",
        },
        status: {
          type: "string",
          enum: ["going", "maybe", "not_going"],
          description: "RSVP status",
        },
      },
      required: ["event_id", "status"],
    },
  },
  {
    name: "list_projects",
    description: "List community projects",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "archived"],
          description: "Filter by project status",
        },
      },
      required: [],
    },
  },
  {
    name: "get_member_profile",
    description: "Get a community member's profile",
    input_schema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description: "The user ID or telegram username",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "update_my_profile",
    description: "Update the requesting user's own profile",
    input_schema: {
      type: "object" as const,
      properties: {
        bio: { type: "string", description: "Short bio" },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "List of skills",
        },
        interests: {
          type: "array",
          items: { type: "string" },
          description: "List of interests",
        },
        current_company: { type: "string", description: "Current company" },
        current_title: { type: "string", description: "Current job title" },
      },
      required: [],
    },
  },
  {
    name: "get_my_reputation",
    description: "Get the requesting user's reputation score",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_leaderboard",
    description: "Get the top reputation scores in the community",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of entries to return (default: 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_fund_overview",
    description: "Get community fund summary. Only available to admins.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_my_balance",
    description: "Get what the community owes the requesting user or vice versa",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];
