import { z } from "zod";

export const aiUsageQuerySchema = z.object({
  from: z.string().optional().describe("Start date (ISO 8601)"),
  to: z.string().optional().describe("End date (ISO 8601)"),
  caller: z
    .string()
    .optional()
    .describe("Filter by caller (e.g. main-agent, events-agent)"),
  model: z.string().optional().describe("Filter by model ID"),
});

export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;
