import { membersService } from "../../services/members.service";
import { aiProfileService } from "../../services/ai-profile.service";

/** Ceiling on any page size an agent can request. */
const MAX_PAGE_SIZE = 100;

export const memberTypeDefs = /* GraphQL */ `
  type UserInfo {
    id: ID!
    name: String!
    image: String
    role: String!
    banned: Boolean!
    telegramUsername: String
  }

  type Member {
    id: ID!
    userId: String!
    githubHandle: String
    bio: String
    skills: [String!]
    interests: [String!]
    currentCompany: String
    currentTitle: String
    education: String
    linkedinUrl: String
    websiteUrl: String
    joinedAt: String
    user: UserInfo!
    """
    AI-derived summary of this member, built from chat history and memories.
    Internal to the AI — never rendered on the public site.
    """
    aiSummary: String
  }

  type MemberConnection {
    items: [Member!]!
    pagination: PaginationMeta!
  }

  extend type Query {
    members(
      q: String
      role: String
      skills: String
      interests: String
      page: Int
      limit: Int
    ): MemberConnection!
    member(userId: String!): Member
    """
    Find members whose AI-derived profile matches a free-text need, e.g.
    "cybersecurity" or "someone who knows Postgres replication".
    Ranked best-match first.
    """
    membersByContext(query: String!, limit: Int): [Member!]!
  }
`;

export const memberResolvers = {
  Query: {
    members: async (
      _: unknown,
      args: {
        q?: string;
        role?: string;
        skills?: string;
        interests?: string;
        page?: number;
        limit?: number;
      },
    ) => {
      const page = args.page ?? 1;
      const limit = Math.min(args.limit ?? 20, MAX_PAGE_SIZE);

      const result = await membersService.list({
        q: args.q,
        role: args.role,
        skills: args.skills,
        interests: args.interests,
        page,
        limit,
      });

      return {
        items: result.members,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          hasNext: result.hasNext,
          hasPrev: result.hasPrev,
        },
      };
    },

    member: async (_: unknown, args: { userId: string }) => {
      try {
        return await membersService.findWithUser(args.userId);
      } catch {
        return null;
      }
    },

    membersByContext: async (
      _: unknown,
      args: { query: string; limit?: number },
    ) => {
      const limit = Math.min(args.limit ?? 5, MAX_PAGE_SIZE);
      const userIds = await aiProfileService.searchByContext(args.query, limit);

      // Resolve in rank order — searchByContext returns best match first, and a
      // bulk fetch would lose that ordering.
      const resolved = await Promise.all(
        userIds.map((id) => membersService.findWithUser(id)),
      );
      return resolved.filter((m) => m !== null);
    },
  },
};
