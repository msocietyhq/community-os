import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import {
  devEnvironments,
  devEnvironmentVars,
  members,
  projectInfraConfigs,
  sharedSecrets,
} from "../db/schema";
import { env } from "../env";
import { neonClient, runMigrationsOn } from "../integrations/neon";
import { decrypt, encrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { createAuditEntry } from "../middleware/audit";

/**
 * Fallback owner for CI-provisioned preview environments whose PR author
 * isn't (or can't be resolved to) a community-os user — e.g. an external
 * contributor. Seeded once via migration; see issue #52 / ADR-008. Every
 * `dev_environments.owner_id` must be non-null, so this exists rather than
 * making the column nullable.
 */
export const SYSTEM_USER_ID = "system-bootstrap";

/** The PR author, if they're a known member (matched by GitHub login); else the system user. */
async function resolvePreviewOwner(githubLogin?: string): Promise<string> {
  if (githubLogin) {
    const [match] = await db
      .select({ userId: members.userId })
      .from(members)
      .where(ilike(members.githubHandle, githubLogin));
    if (match) return match.userId;
  }
  return SYSTEM_USER_ID;
}

async function getEnvironment(id: string) {
  const [row] = await db
    .select()
    .from(devEnvironments)
    .where(eq(devEnvironments.id, id));

  if (!row) {
    throw new AppError(
      404,
      "ENVIRONMENT_NOT_FOUND",
      "Dev environment not found",
    );
  }
  return row;
}

export const devEnvironmentsService = {
  async create(input: { projectId: string; ownerId: string; label?: string }) {
    const [environment] = await db
      .insert(devEnvironments)
      .values({
        projectId: input.projectId,
        ownerId: input.ownerId,
        label: input.label,
      })
      .returning();

    if (!environment) {
      throw new AppError(
        500,
        "CREATE_FAILED",
        "Failed to create dev environment",
      );
    }

    // Auto-attach every one of the project's shared secrets — this is what
    // makes a new environment self-serve: nobody has to wire a contributor
    // up to the project's staging keys by hand.
    const projectSecrets = await db
      .select({ id: sharedSecrets.id, key: sharedSecrets.key })
      .from(sharedSecrets)
      .where(eq(sharedSecrets.projectId, input.projectId));

    if (projectSecrets.length > 0) {
      await db.insert(devEnvironmentVars).values(
        projectSecrets.map((s) => ({
          environmentId: environment.id,
          key: s.key,
          sharedSecretId: s.id,
        })),
      );
    }

    await createAuditEntry({
      entityType: "dev_environment",
      entityId: environment.id,
      action: "create",
      newValue: {
        projectId: input.projectId,
        label: input.label ?? null,
        attachedSharedSecrets: projectSecrets.length,
      },
      performedBy: input.ownerId,
    });

    return environment;
  },

  /** Environments for a project — scoped to the caller's own unless `canSeeAll`. */
  async list(projectId: string, requester: { id: string; canSeeAll: boolean }) {
    const conditions = [eq(devEnvironments.projectId, projectId)];
    if (!requester.canSeeAll) {
      conditions.push(eq(devEnvironments.ownerId, requester.id));
    }

    return db
      .select()
      .from(devEnvironments)
      .where(and(...conditions))
      .orderBy(desc(devEnvironments.createdAt));
  },

  async getById(id: string) {
    return getEnvironment(id);
  },

  async revoke(id: string, performedBy: string) {
    const [row] = await db
      .update(devEnvironments)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: performedBy })
      .where(eq(devEnvironments.id, id))
      .returning();

    if (!row) {
      throw new AppError(
        404,
        "ENVIRONMENT_NOT_FOUND",
        "Dev environment not found",
      );
    }

    await createAuditEntry({
      entityType: "dev_environment",
      entityId: id,
      action: "revoke",
      newValue: { projectId: row.projectId },
      performedBy,
    });

    return row;
  },

  /** Metadata only — key + source. Never a value. */
  async listVars(environmentId: string) {
    const rows = await db
      .select({
        key: devEnvironmentVars.key,
        sharedSecretId: devEnvironmentVars.sharedSecretId,
      })
      .from(devEnvironmentVars)
      .where(eq(devEnvironmentVars.environmentId, environmentId));

    return rows.map((r) => ({
      key: r.key,
      source: r.sharedSecretId ? ("shared" as const) : ("generated" as const),
    }));
  },

  /**
   * Manually sets a generated var (e.g. DATABASE_URL) for one environment.
   * Stand-in until Neon branch provisioning mints this automatically.
   */
  async storeVar(params: {
    environmentId: string;
    key: string;
    value: string;
    performedBy: string;
  }) {
    await getEnvironment(params.environmentId);
    const payload = encrypt(params.value, env.SECRETS_ENCRYPTION_KEY);

    const [row] = await db
      .insert(devEnvironmentVars)
      .values({
        environmentId: params.environmentId,
        key: params.key,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
      })
      .onConflictDoUpdate({
        target: [devEnvironmentVars.environmentId, devEnvironmentVars.key],
        set: {
          sharedSecretId: null,
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          authTag: payload.authTag,
        },
      })
      .returning({ id: devEnvironmentVars.id, key: devEnvironmentVars.key });

    if (!row) {
      throw new AppError(
        500,
        "STORE_FAILED",
        "Failed to store environment var",
      );
    }

    await createAuditEntry({
      entityType: "dev_environment",
      entityId: params.environmentId,
      action: "create",
      newValue: { key: params.key, source: "generated" },
      performedBy: params.performedBy,
    });

    return row;
  },

  /** Decrypts the full bundle for this environment. Every call is audited. */
  async reveal(
    environmentId: string,
    performedBy: string,
    auditContext?: Record<string, unknown>,
  ) {
    const environment = await getEnvironment(environmentId);

    const rows = await db
      .select({
        key: devEnvironmentVars.key,
        ownCiphertext: devEnvironmentVars.ciphertext,
        ownIv: devEnvironmentVars.iv,
        ownAuthTag: devEnvironmentVars.authTag,
        sharedCiphertext: sharedSecrets.ciphertext,
        sharedIv: sharedSecrets.iv,
        sharedAuthTag: sharedSecrets.authTag,
      })
      .from(devEnvironmentVars)
      .leftJoin(
        sharedSecrets,
        eq(devEnvironmentVars.sharedSecretId, sharedSecrets.id),
      )
      .where(eq(devEnvironmentVars.environmentId, environmentId));

    const vars: Record<string, string> = {};
    for (const row of rows) {
      const payload = row.sharedCiphertext
        ? {
            ciphertext: row.sharedCiphertext,
            iv: row.sharedIv!,
            authTag: row.sharedAuthTag!,
          }
        : {
            ciphertext: row.ownCiphertext!,
            iv: row.ownIv!,
            authTag: row.ownAuthTag!,
          };
      vars[row.key] = decrypt(payload, env.SECRETS_ENCRYPTION_KEY);
    }

    await createAuditEntry({
      entityType: "dev_environment",
      entityId: environmentId,
      action: "reveal",
      newValue: { keys: Object.keys(vars), ...auditContext },
      performedBy,
    });

    return { environmentId, projectId: environment.projectId, vars };
  },

  /**
   * Finds-or-creates the PR preview environment for (projectId, prNumber),
   * so it's safe to call on every `ci/ensure` (every PR open/push): a
   * still-active environment is returned as-is, with no new Neon branch.
   * A missing or torn-down one gets a fresh branch, freshly migrated.
   */
  async ensurePreviewEnvironment(input: {
    projectId: string;
    prNumber: number;
    prAuthorGithubLogin?: string;
  }) {
    const [existing] = await db
      .select()
      .from(devEnvironments)
      .where(
        and(
          eq(devEnvironments.projectId, input.projectId),
          eq(devEnvironments.prNumber, input.prNumber),
          eq(devEnvironments.status, "active"),
        ),
      )
      .orderBy(desc(devEnvironments.createdAt))
      .limit(1);

    if (existing) return existing;

    const [infraConfig] = await db
      .select()
      .from(projectInfraConfigs)
      .where(eq(projectInfraConfigs.projectId, input.projectId));

    if (!infraConfig?.neonProjectId) {
      throw new AppError(
        400,
        "INFRA_NOT_CONFIGURED",
        "This project has no Neon project configured — set one up in the project's infra settings first",
      );
    }

    const ownerId = await resolvePreviewOwner(input.prAuthorGithubLogin);
    const branchName = `pr-${input.prNumber}`;

    const { branchId, databaseUrl } = await neonClient.createBranch(
      infraConfig.neonProjectId,
      branchName,
    );
    await runMigrationsOn(databaseUrl);

    const environment = await devEnvironmentsService.create({
      projectId: input.projectId,
      ownerId,
      label: branchName,
    });

    const [updated] = await db
      .update(devEnvironments)
      .set({ prNumber: input.prNumber, neonBranchId: branchId })
      .where(eq(devEnvironments.id, environment.id))
      .returning();

    await devEnvironmentsService.storeVar({
      environmentId: environment.id,
      key: "DATABASE_URL",
      value: databaseUrl,
      performedBy: ownerId,
    });

    return updated ?? environment;
  },

  /** Deletes the PR's Neon branch and revokes its environment. A no-op if none exists. */
  async teardownPreviewEnvironment(input: {
    projectId: string;
    prNumber: number;
  }) {
    const [existing] = await db
      .select()
      .from(devEnvironments)
      .where(
        and(
          eq(devEnvironments.projectId, input.projectId),
          eq(devEnvironments.prNumber, input.prNumber),
          eq(devEnvironments.status, "active"),
        ),
      );

    if (!existing) return null;

    if (existing.neonBranchId) {
      const [infraConfig] = await db
        .select()
        .from(projectInfraConfigs)
        .where(eq(projectInfraConfigs.projectId, input.projectId));

      if (infraConfig?.neonProjectId) {
        try {
          await neonClient.deleteBranch(
            infraConfig.neonProjectId,
            existing.neonBranchId,
          );
        } catch (err) {
          // Don't let an already-gone (or unreachable) Neon branch block
          // revoking our own record of the environment.
          console.error(
            `Failed to delete Neon branch ${existing.neonBranchId}:`,
            err,
          );
        }
      }
    }

    return devEnvironmentsService.revoke(existing.id, existing.ownerId);
  },
};
