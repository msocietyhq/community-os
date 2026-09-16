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
  // Optional: a deployment running only Anthropic models must still boot.
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  // Remote computer for the agent's exec tool. All three must be set
  // or the tool is not registered. The key may be PEM, `\n`-escaped PEM,
  // or base64.
  EXEC_SSH_HOST: z.string().optional(),
  EXEC_SSH_USER: z.string().optional(),
  EXEC_SSH_PRIVATE_KEY: z.string().optional(),
  EXEC_SSH_PORT: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
