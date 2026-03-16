import { z } from "zod";

export const loginCodeQuerySchema = z.object({
  code: z.string(),
});

export type LoginCodeQuery = z.infer<typeof loginCodeQuerySchema>;
