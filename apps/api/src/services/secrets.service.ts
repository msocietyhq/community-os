import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { provisionedResources, resourceSecrets } from "../db/schema";
import { env } from "../env";
import { decrypt, encrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { createAuditEntry } from "../middleware/audit";

async function assertResourceExists(provisionedResourceId: string) {
  const [row] = await db
    .select({ id: provisionedResources.id })
    .from(provisionedResources)
    .where(eq(provisionedResources.id, provisionedResourceId));

  if (!row) {
    throw new AppError(
      404,
      "RESOURCE_NOT_FOUND",
      "Provisioned resource not found",
    );
  }
}

async function findSecret(provisionedResourceId: string, key: string) {
  const [row] = await db
    .select()
    .from(resourceSecrets)
    .where(
      and(
        eq(resourceSecrets.provisionedResourceId, provisionedResourceId),
        eq(resourceSecrets.key, key),
      ),
    );
  return row ?? null;
}

export const secretsService = {
  /** Metadata only — keys, timestamps, who last revealed. Never the value. */
  async list(provisionedResourceId: string) {
    await assertResourceExists(provisionedResourceId);
    return db
      .select({
        key: resourceSecrets.key,
        createdAt: resourceSecrets.createdAt,
        rotatedAt: resourceSecrets.rotatedAt,
        lastRevealedAt: resourceSecrets.lastRevealedAt,
        lastRevealedBy: resourceSecrets.lastRevealedBy,
      })
      .from(resourceSecrets)
      .where(eq(resourceSecrets.provisionedResourceId, provisionedResourceId));
  },

  /** Creates a secret, or rotates it in place if the key already exists. */
  async store(params: {
    provisionedResourceId: string;
    key: string;
    value: string;
    performedBy: string;
  }) {
    await assertResourceExists(params.provisionedResourceId);
    const existing = await findSecret(params.provisionedResourceId, params.key);
    const payload = encrypt(params.value, env.SECRETS_ENCRYPTION_KEY);
    const now = new Date();

    const [row] = await db
      .insert(resourceSecrets)
      .values({
        provisionedResourceId: params.provisionedResourceId,
        key: params.key,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        createdBy: params.performedBy,
      })
      .onConflictDoUpdate({
        target: [resourceSecrets.provisionedResourceId, resourceSecrets.key],
        set: {
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          authTag: payload.authTag,
          rotatedAt: now,
          updatedAt: now,
        },
      })
      .returning({
        id: resourceSecrets.id,
        key: resourceSecrets.key,
        createdAt: resourceSecrets.createdAt,
        rotatedAt: resourceSecrets.rotatedAt,
      });

    if (!row) {
      throw new AppError(500, "STORE_FAILED", "Failed to store secret");
    }

    await createAuditEntry({
      entityType: "resource_secret",
      entityId: row.id,
      action: existing ? "rotate" : "create",
      newValue: {
        provisionedResourceId: params.provisionedResourceId,
        key: params.key,
      },
      performedBy: params.performedBy,
    });

    return row;
  },

  /** Decrypts and returns the value. Every call is audited — this is the only path to plaintext. */
  async reveal(params: {
    provisionedResourceId: string;
    key: string;
    performedBy: string;
  }) {
    const row = await findSecret(params.provisionedResourceId, params.key);
    if (!row) {
      throw new AppError(404, "SECRET_NOT_FOUND", "Secret not found");
    }

    const value = decrypt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag },
      env.SECRETS_ENCRYPTION_KEY,
    );

    const now = new Date();
    await db
      .update(resourceSecrets)
      .set({ lastRevealedAt: now, lastRevealedBy: params.performedBy })
      .where(eq(resourceSecrets.id, row.id));

    await createAuditEntry({
      entityType: "resource_secret",
      entityId: row.id,
      action: "reveal",
      newValue: {
        provisionedResourceId: params.provisionedResourceId,
        key: params.key,
      },
      performedBy: params.performedBy,
    });

    return { key: row.key, value };
  },

  async delete(params: {
    provisionedResourceId: string;
    key: string;
    performedBy: string;
  }) {
    const [row] = await db
      .delete(resourceSecrets)
      .where(
        and(
          eq(
            resourceSecrets.provisionedResourceId,
            params.provisionedResourceId,
          ),
          eq(resourceSecrets.key, params.key),
        ),
      )
      .returning({ id: resourceSecrets.id });

    if (!row) {
      throw new AppError(404, "SECRET_NOT_FOUND", "Secret not found");
    }

    await createAuditEntry({
      entityType: "resource_secret",
      entityId: row.id,
      action: "delete",
      newValue: {
        provisionedResourceId: params.provisionedResourceId,
        key: params.key,
      },
      performedBy: params.performedBy,
    });
  },
};
