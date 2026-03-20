import { projectsService } from "../../services/projects.service";

export const projectTypeDefs = /* GraphQL */ `
  type ProjectMemberPreview {
    id: ID!
    name: String!
    image: String
  }

  type Project {
    id: ID!
    name: String!
    slug: String!
    description: String
    nature: String!
    platforms: [String!]
    status: String!
    url: String
    repoUrl: String
    thumbnailUrl: String
    isEndorsed: Boolean!
    createdAt: String
    memberCount: Int!
    members: [ProjectMemberPreview!]!
  }

  type ProjectConnection {
    items: [Project!]!
    pagination: PaginationMeta!
  }

  extend type Query {
    projects(
      status: String
      nature: String
      q: String
      page: Int
      limit: Int
    ): ProjectConnection!
    project(id: String!): Project
  }
`;

export const projectResolvers = {
  Query: {
    projects: async (
      _: unknown,
      args: {
        status?: string;
        nature?: string;
        q?: string;
        page?: number;
        limit?: number;
      },
    ) => {
      const page = args.page ?? 1;
      const limit = args.limit ?? 20;

      const result = await projectsService.list({
        status: args.status as "active" | "paused" | "archived" | undefined,
        nature: args.nature as "startup" | "community" | "side_project" | undefined,
        search: args.q,
        page,
        limit,
      });

      return {
        items: result.projects,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          hasNext: result.hasNext,
          hasPrev: result.hasPrev,
        },
      };
    },

    project: async (_: unknown, args: { id: string }) => {
      try {
        const p = await projectsService.getById(args.id);
        return { ...p, memberCount: p.members.length };
      } catch {
        return null;
      }
    },
  },
};
