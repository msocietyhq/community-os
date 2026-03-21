import { Elysia } from "elysia";
import { searchQuerySchema } from "@community-os/shared/validators";

export const searchModel = new Elysia({ name: "model.search" }).model({
  "search.query": searchQuerySchema,
});
