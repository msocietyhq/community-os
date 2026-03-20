import { makeExecutableSchema } from "@graphql-tools/schema";
import { commonTypeDefs } from "./types/common";
import { eventTypeDefs, eventResolvers } from "./types/event";
import { projectTypeDefs, projectResolvers } from "./types/project";
import { venueTypeDefs, venueResolvers } from "./types/venue";
import { memberTypeDefs, memberResolvers } from "./types/member";

const baseTypeDefs = /* GraphQL */ `
  type Query {
    _empty: String
  }
`;

export const schema = makeExecutableSchema({
  typeDefs: [
    baseTypeDefs,
    commonTypeDefs,
    eventTypeDefs,
    projectTypeDefs,
    venueTypeDefs,
    memberTypeDefs,
  ],
  resolvers: [
    eventResolvers,
    projectResolvers,
    venueResolvers,
    memberResolvers,
  ],
});
