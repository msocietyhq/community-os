import { venuesService } from "../../services/venues.service";

export const venueTypeDefs = /* GraphQL */ `
  type Venue {
    id: ID!
    name: String!
    address: String
    city: String
    country: String
    postalCode: String
    mapsUrl: String
    capacity: Int
    costPerDay: String
    costNotes: String
    notes: String
    createdAt: String
  }

  type VenueConnection {
    items: [Venue!]!
    pagination: PaginationMeta!
  }

  extend type Query {
    venues(q: String, page: Int, limit: Int): VenueConnection!
    venue(id: String!): Venue
  }
`;

export const venueResolvers = {
  Query: {
    venues: async (
      _: unknown,
      args: { q?: string; page?: number; limit?: number },
    ) => {
      const page = args.page ?? 1;
      const limit = args.limit ?? 20;

      const result = await venuesService.list({ q: args.q, page, limit });

      return {
        items: result.venues,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          hasNext: result.hasNext,
          hasPrev: result.hasPrev,
        },
      };
    },

    venue: async (_: unknown, args: { id: string }) => {
      try {
        return await venuesService.getById(args.id);
      } catch {
        return null;
      }
    },
  },
};
