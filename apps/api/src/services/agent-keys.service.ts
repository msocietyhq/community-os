import type { IssueAgentKeyInput } from "@community-os/shared/validators";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { devEnvironmentAgentKeys } from "../db/schema";
import { generateAgentKeyToken, hashAgentKeyToken } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { createAuditEntry } from "../middleware/audit";
import { devEnvironmentsService } from "./dev-environments.service";

export const agentKeysService = {
  /** Mints a short-lived bearer token for an environment. Returned once — only the hash is stored. */
  async issue(
    environmentId: string,
    input: IssueAgentKeyInput,
    issuedBy: string,
  ) {
    const token = generateAgentKeyToken();
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);

    const [row] = await db
      .insert(devEnvironmentAgentKeys)
      .values({
        environmentId,
        tokenHash: hashAgentKeyToken(token),
        label: input.label,
        issuedBy,
        expiresAt,
      })
      .returning({
        id: devEnvironmentAgentKeys.id,
        label: devEnvironmentAgentKeys.label,
        expiresAt: devEnvironmentAgentKeys.expiresAt,
      });

    if (!row) {
      throw new AppError(500, "ISSUE_FAILED", "Failed to issue agent key");
    }

    await createAuditEntry({
      entityType: "agent_key",
      entityId: row.id,
      action: "issue",
      newValue: { environmentId, expiresAt: row.expiresAt },
      performedBy: issuedBy,
    });

    return { ...row, token };
  },

  /** Metadata only — never the token or its hash. */
  async list(environmentId: string) {
    return db
      .select({
        id: devEnvironmentAgentKeys.id,
        label: devEnvironmentAgentKeys.label,
        issuedBy: devEnvironmentAgentKeys.issuedBy,
        expiresAt: devEnvironmentAgentKeys.expiresAt,
        revokedAt: devEnvironmentAgentKeys.revokedAt,
        lastUsedAt: devEnvironmentAgentKeys.lastUsedAt,
        createdAt: devEnvironmentAgentKeys.createdAt,
      })
      .from(devEnvironmentAgentKeys)
      .where(eq(devEnvironmentAgentKeys.environmentId, environmentId));
  },

  async revoke(id: string, performedBy: string) {
    const [row] = await db
      .update(devEnvironmentAgentKeys)
      .set({ revokedAt: new Date() })
      .where(eq(devEnvironmentAgentKeys.id, id))
      .returning({
        id: devEnvironmentAgentKeys.id,
        environmentId: devEnvironmentAgentKeys.environmentId,
      });

    if (!row) {
      throw new AppError(404, "AGENT_KEY_NOT_FOUND", "Agent key not found");
    }

    await createAuditEntry({
      entityType: "agent_key",
      entityId: id,
      action: "revoke",
      newValue: { environmentId: row.environmentId },
      performedBy,
    });

    return row;
  },

  /**
   * Redeems a raw token for its environment's env var bundle — the path an
   * agent session (no Better Auth session of its own) actually uses. Not
   * gated behind `authMiddleware`; the token itself is the credential.
   */
  async redeem(rawToken: string) {
    const [key] = await db
      .select()
      .from(devEnvironmentAgentKeys)
      .where(
        eq(devEnvironmentAgentKeys.tokenHash, hashAgentKeyToken(rawToken)),
      );

    if (!key) {
      throw new AppError(401, "INVALID_AGENT_KEY", "Invalid agent key");
    }
    if (key.revokedAt) {
      throw new AppError(
        401,
        "AGENT_KEY_REVOKED",
        "Agent key has been revoked",
      );
    }
    if (key.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "AGENT_KEY_EXPIRED", "Agent key has expired");
    }

    await db
      .update(devEnvironmentAgentKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(devEnvironmentAgentKeys.id, key.id));

    return devEnvironmentsService.reveal(key.environmentId, key.issuedBy, {
      viaAgentKeyId: key.id,
    });
  },
};
