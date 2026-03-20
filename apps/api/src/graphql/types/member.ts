import { membersService } from "../../services/members.service";

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
      const limit = args.limit ?? 20;

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
  },
};
