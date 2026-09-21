import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  API_URL: z.string().url(),
  RAILWAY_API_TOKEN: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  NEON_API_KEY: z.string().optional(),
  // Shared by every endorsed-project repo's reusable preview-db.yml workflow
  // (issue #52) — one org-wide credential, not per-repo, so a new project
  // needs zero GitHub secrets of its own to get PR preview databases.
  CI_SERVICE_TOKEN: z.string().optional(),
  // 32-byte AES-256-GCM key, hex-encoded (64 chars). Generate with
  // `openssl rand -hex 32`. Encrypts secrets generated during infra
  // provisioning (DB connection strings, deploy tokens) at rest.
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be a 64-character hex string (32 bytes)"),
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
  WEB_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
