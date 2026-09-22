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

// --- Preview-environment provisioning (issue #52 / ADR-009) ---

// Undefined (key omitted) leaves a field as-is; null explicitly clears it —
// needed so e.g. picking a different Railway project can reset the
// service/source-environment fields that belonged to the old one.
const clearableId = z.string().min(1).max(200).nullable().optional();
export const upsertProjectInfraConfigSchema = z.object({
  neonProjectId: clearableId,
  railwayProjectId: clearableId,
  railwayServiceId: clearableId,
  railwaySourceEnvironmentId: clearableId,
});
export type UpsertProjectInfraConfigInput = z.infer<
  typeof upsertProjectInfraConfigSchema
>;

export const createNeonProjectSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateNeonProjectInput = z.infer<typeof createNeonProjectSchema>;

export const createRailwayProjectSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateRailwayProjectInput = z.infer<
  typeof createRailwayProjectSchema
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
