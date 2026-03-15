import { z } from "zod";

export const telegramAuthSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;

export const loginCodeQuerySchema = z.object({
  code: z.string(),
});

export type LoginCodeQuery = z.infer<typeof loginCodeQuerySchema>;
