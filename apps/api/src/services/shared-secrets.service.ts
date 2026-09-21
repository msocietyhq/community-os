import type {
  CreateSharedSecretInput,
  RotateSharedSecretInput,
} from "@community-os/shared/validators";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sharedSecrets } from "../db/schema";
import { env } from "../env";
import { decrypt, encrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { createAuditEntry } from "../middleware/audit";

async function getRow(id: string) {
  const [row] = await db
    .select()
    .from(sharedSecrets)
    .where(eq(sharedSecrets.id, id));

  if (!row) {
    throw new AppError(
      404,
      "SHARED_SECRET_NOT_FOUND",
      "Shared secret not found",
    );
  }
  return row;
}

export const sharedSecretsService = {
  /** Metadata only — key, description, rotation history. Never the value. */
  async list(projectId: string) {
    return db
      .select({
        id: sharedSecrets.id,
        key: sharedSecrets.key,
        description: sharedSecrets.description,
        rotatedAt: sharedSecrets.rotatedAt,
        createdAt: sharedSecrets.createdAt,
      })
      .from(sharedSecrets)
      .where(eq(sharedSecrets.projectId, projectId));
  },

  async create(input: CreateSharedSecretInput, createdBy: string) {
    const payload = encrypt(input.value, env.SECRETS_ENCRYPTION_KEY);

    const [row] = await db
      .insert(sharedSecrets)
      .values({
        projectId: input.projectId,
        key: input.key,
        description: input.description,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        createdBy,
      })
      .returning({
        id: sharedSecrets.id,
        projectId: sharedSecrets.projectId,
        key: sharedSecrets.key,
        description: sharedSecrets.description,
        createdAt: sharedSecrets.createdAt,
      });

    if (!row) {
      throw new AppError(
        500,
        "CREATE_FAILED",
        "Failed to create shared secret",
      );
    }

    await createAuditEntry({
      entityType: "shared_secret",
      entityId: row.id,
      action: "create",
      newValue: { projectId: row.projectId, key: row.key },
      performedBy: createdBy,
    });

    return row;
  },

  async rotate(
    id: string,
    input: RotateSharedSecretInput,
    performedBy: string,
  ) {
    const existing = await getRow(id);
    const payload = encrypt(input.value, env.SECRETS_ENCRYPTION_KEY);
    const now = new Date();

    const [row] = await db
      .update(sharedSecrets)
      .set({
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        rotatedAt: now,
        updatedAt: now,
      })
      .where(eq(sharedSecrets.id, id))
      .returning({
        id: sharedSecrets.id,
        key: sharedSecrets.key,
        rotatedAt: sharedSecrets.rotatedAt,
      });

    if (!row) {
      throw new AppError(
        500,
        "ROTATE_FAILED",
        "Failed to rotate shared secret",
      );
    }

    await createAuditEntry({
      entityType: "shared_secret",
      entityId: row.id,
      action: "rotate",
      newValue: { projectId: existing.projectId, key: row.key },
      performedBy,
    });

    return row;
  },

  async delete(id: string, performedBy: string) {
    const existing = await getRow(id);

    await db.delete(sharedSecrets).where(eq(sharedSecrets.id, id));

    await createAuditEntry({
      entityType: "shared_secret",
      entityId: id,
      action: "delete",
      newValue: { projectId: existing.projectId, key: existing.key },
      performedBy,
    });
  },

  /** Internal — used by the dev-environments service to build a reveal bundle. Never exposed directly. */
  async getDecrypted(id: string): Promise<{ key: string; value: string }> {
    const row = await getRow(id);
    const value = decrypt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag },
      env.SECRETS_ENCRYPTION_KEY,
    );
    return { key: row.key, value };
  },
};
