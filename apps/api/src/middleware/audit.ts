import { db } from "../db";
import { auditLog } from "../db/schema";
import type { AuditAction, AuditEntityType } from "@community-os/shared";

export async function createAuditEntry(params: {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  oldValue?: unknown;
  newValue: unknown;
  performedBy?: string;
  ipAddress?: string;
}) {
  await db.insert(auditLog).values({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue,
    performedBy: params.performedBy ?? null,
    ipAddress: params.ipAddress ?? null,
  });
}
