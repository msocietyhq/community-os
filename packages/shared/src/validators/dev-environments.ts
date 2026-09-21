import { z } from "zod";

export const createDevEnvironmentSchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().min(1).max(100).optional(),
});
export type CreateDevEnvironmentInput = z.infer<
  typeof createDevEnvironmentSchema
>;

export const storeDevEnvironmentVarSchema = z.object({
  value: z.string().min(1).max(8192),
});
export type StoreDevEnvironmentVarInput = z.infer<
  typeof storeDevEnvironmentVarSchema
>;

export const issueAgentKeySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  // Ephemeral by design — defaults to an hour, capped at a day.
  expiresInMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(60),
});
export type IssueAgentKeyInput = z.infer<typeof issueAgentKeySchema>;

export const createSharedSecretSchema = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1).max(100),
  description: z.string().optional(),
  value: z.string().min(1).max(8192),
});
export type CreateSharedSecretInput = z.infer<typeof createSharedSecretSchema>;

export const rotateSharedSecretSchema = z.object({
  value: z.string().min(1).max(8192),
});
export type RotateSharedSecretInput = z.infer<typeof rotateSharedSecretSchema>;
