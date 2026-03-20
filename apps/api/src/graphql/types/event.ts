import { eventsService } from "../../services/events.service";
import type { GraphQLContext } from "../context";

export const eventTypeDefs = /* GraphQL */ `
  type Event {
    id: ID!
    title: String!
    slug: String!
    description: String
    eventType: String!
    status: String!
    isOnline: Boolean
    onlineUrl: String
    startsAt: String!
    endsAt: String
    maxAttendees: Int
    venueName: String
    attendeeCount: Int!
    maybeCount: Int!
    createdAt: String
  }

  type EventConnection {
    items: [Event!]!
    pagination: PaginationMeta!
  }

  extend type Query {
    events(
      status: String
      eventType: String
      startsAfter: String
      startsBefore: String
      q: String
      page: Int
      limit: Int
    ): EventConnection!
    event(id: String!): Event
  }
`;

export const eventResolvers = {
  Query: {
    events: async (
      _: unknown,
      args: {
        status?: string;
        eventType?: string;
        startsAfter?: string;
        startsBefore?: string;
        q?: string;
        page?: number;
        limit?: number;
      },
      ctx: GraphQLContext,
    ) => {
      const page = args.page ?? 1;
      const limit = args.limit ?? 20;
      const userRole = ctx.user?.role ?? "member";

      const result = await eventsService.list(
        {
          status: args.status as "published" | "completed" | "cancelled" | "draft" | undefined,
          eventType: args.eventType as "meetup" | "workshop" | "hackathon" | "talk" | "social" | "other" | undefined,
          startsAfter: args.startsAfter ? new Date(args.startsAfter) : undefined,
          startsBefore: args.startsBefore ? new Date(args.startsBefore) : undefined,
          page,
          limit,
        },
        userRole,
      );

      return {
        items: result.events,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          hasNext: result.hasNext,
          hasPrev: result.hasPrev,
        },
      };
    },

    event: async (_: unknown, args: { id: string }) => {
      try {
        return await eventsService.getById(args.id);
      } catch {
        return null;
      }
    },
  },
};
