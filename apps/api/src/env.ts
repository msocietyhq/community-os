import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  RAILWAY_API_TOKEN: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  NEON_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default("msocietybot"),
  API_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
