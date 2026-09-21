import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { auditLog, devEnvironments } from "../db/schema";

/**
 * `audit_log` has been written to since ADR-006 but had no read path at
 * all — every reveal/create/revoke/rotate was recorded and then invisible.
 * This is the first reader: a project's infra-related activity (its own
 * `project_infra_config` row, plus every `dev_environment` under it), for
 * the "who did what, when" half of usage tracing (issue #52 follow-up /
 * ADR-010). Generalize into a real audit-browsing feature if/when another
 * entity type needs the same treatment — this one is scoped to what the
 * infra-config admin page actually shows.
 */
export const auditLogService = {
  async listForProjectInfra(projectId: string, limit = 50) {
    const environments = await db
      .select({ id: devEnvironments.id })
      .from(devEnvironments)
      .where(eq(devEnvironments.projectId, projectId));
    const environmentIds = environments.map((e) => e.id);

    const scopeConditions = [
      and(
        eq(auditLog.entityType, "project_infra_config"),
        eq(auditLog.entityId, projectId),
      ),
    ];
    if (environmentIds.length > 0) {
      scopeConditions.push(
        and(
          eq(auditLog.entityType, "dev_environment"),
          inArray(auditLog.entityId, environmentIds),
        ),
      );
    }

    return db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        newValue: auditLog.newValue,
        performedBy: auditLog.performedBy,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(or(...scopeConditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
  },
};
