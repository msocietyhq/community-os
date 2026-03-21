import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.enum(["messages", "memories", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
