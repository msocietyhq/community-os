import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().default("msocietybot"),
  API_URL: z.string().url().default("http://localhost:3000"),
  ANTHROPIC_API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
