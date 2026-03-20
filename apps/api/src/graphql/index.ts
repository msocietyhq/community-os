import { createYoga } from "graphql-yoga";
import { printSchema } from "graphql";
import { schema } from "./schema";
import { buildContext, type GraphQLContext } from "./context";

export const yoga = createYoga<Record<string, unknown>, GraphQLContext>({
  schema,
  context: ({ request }) => buildContext(request),
  graphqlEndpoint: "/graphql",
  landingPage: true,
});

export const schemaSDL = printSchema(schema);

export type { GraphQLContext } from "./context";
