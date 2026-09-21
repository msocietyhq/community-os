import type { IssueProjectBootstrapTokenInput } from "@community-os/shared/validators";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { projectBootstrapTokens } from "../db/schema";
import {
  generateProjectBootstrapToken,
  hashProjectBootstrapToken,
} from "../lib/crypto";
import { AppError } from "../lib/errors";
import { createAuditEntry } from "../middleware/audit";

export const projectBootstrapTokensService = {
  /**
   * Mints the long-lived credential a project's Railway service clones into
   * every PR environment (issue #52). Returned once — only the hash is
   * stored. Minting a new one doesn't revoke any existing token; rotate by
   * issuing then revoking the old one once the new value is deployed.
   */
  async issue(
    projectId: string,
    input: IssueProjectBootstrapTokenInput,
    issuedBy: string,
  ) {
    const token = generateProjectBootstrapToken();

    const [row] = await db
      .insert(projectBootstrapTokens)
      .values({
        projectId,
        tokenHash: hashProjectBootstrapToken(token),
        label: input.label,
        createdBy: issuedBy,
      })
      .returning({
        id: projectBootstrapTokens.id,
        label: projectBootstrapTokens.label,
        createdAt: projectBootstrapTokens.createdAt,
      });

    if (!row) {
      throw new AppError(
        500,
        "ISSUE_FAILED",
        "Failed to issue project bootstrap token",
      );
    }

    await createAuditEntry({
      entityType: "project_bootstrap_token",
      entityId: row.id,
      action: "issue",
      newValue: { projectId },
      performedBy: issuedBy,
    });

    return { ...row, token };
  },

  /** Metadata only — never the token or its hash. */
  async list(projectId: string) {
    return db
      .select({
        id: projectBootstrapTokens.id,
        label: projectBootstrapTokens.label,
        createdBy: projectBootstrapTokens.createdBy,
        revokedAt: projectBootstrapTokens.revokedAt,
        lastUsedAt: projectBootstrapTokens.lastUsedAt,
        createdAt: projectBootstrapTokens.createdAt,
      })
      .from(projectBootstrapTokens)
      .where(eq(projectBootstrapTokens.projectId, projectId));
  },

  async revoke(id: string, performedBy: string) {
    const [row] = await db
      .update(projectBootstrapTokens)
      .set({ revokedAt: new Date() })
      .where(eq(projectBootstrapTokens.id, id))
      .returning({
        id: projectBootstrapTokens.id,
        projectId: projectBootstrapTokens.projectId,
      });

    if (!row) {
      throw new AppError(
        404,
        "BOOTSTRAP_TOKEN_NOT_FOUND",
        "Project bootstrap token not found",
      );
    }

    await createAuditEntry({
      entityType: "project_bootstrap_token",
      entityId: id,
      action: "revoke",
      newValue: { projectId: row.projectId },
      performedBy,
    });

    return row;
  },

  /** Verifies a raw token, returning the project it grants access to. Throws on any failure. */
  async verify(rawToken: string): Promise<{ projectId: string }> {
    const [row] = await db
      .select({
        id: projectBootstrapTokens.id,
        projectId: projectBootstrapTokens.projectId,
      })
      .from(projectBootstrapTokens)
      .where(
        and(
          eq(
            projectBootstrapTokens.tokenHash,
            hashProjectBootstrapToken(rawToken),
          ),
          isNull(projectBootstrapTokens.revokedAt),
        ),
      );

    if (!row) {
      throw new AppError(
        401,
        "INVALID_BOOTSTRAP_TOKEN",
        "Invalid or revoked bootstrap token",
      );
    }

    await db
      .update(projectBootstrapTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(projectBootstrapTokens.id, row.id));

    return { projectId: row.projectId };
  },
};
