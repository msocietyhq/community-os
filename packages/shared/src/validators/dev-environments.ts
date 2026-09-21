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

// --- Preview-environment provisioning (issue #52) ---

export const upsertProjectInfraConfigSchema = z.object({
  neonProjectId: z.string().min(1).max(200).optional(),
  railwayProjectId: z.string().min(1).max(200).optional(),
  railwayServiceId: z.string().min(1).max(200).optional(),
});
export type UpsertProjectInfraConfigInput = z.infer<
  typeof upsertProjectInfraConfigSchema
>;

export const issueProjectBootstrapTokenSchema = z.object({
  label: z.string().min(1).max(100).optional(),
});
export type IssueProjectBootstrapTokenInput = z.infer<
  typeof issueProjectBootstrapTokenSchema
>;

/** Body for the reusable GitHub Actions workflow's ensure/teardown calls. */
export const ciPreviewEnvironmentSchema = z.object({
  repoFullName: z.string().min(1).max(200),
  prNumber: z.number().int().positive(),
  prAuthorGithubLogin: z.string().min(1).max(100).optional(),
});
export type CiPreviewEnvironmentInput = z.infer<
  typeof ciPreviewEnvironmentSchema
>;

/** Body a project's own Railway service sends itself at boot, via the preflight script. */
export const bootstrapPreviewEnvironmentSchema = z.object({
  prNumber: z.number().int().positive(),
});
export type BootstrapPreviewEnvironmentInput = z.infer<
  typeof bootstrapPreviewEnvironmentSchema
>;
