import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  API_URL: z.string().url(),
  RAILWAY_API_TOKEN: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  NEON_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_GROUP_ID: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default("msocietybot"),
  ANTHROPIC_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().optional(),
  WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
