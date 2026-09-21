import type { UpsertProjectInfraConfigInput } from "@community-os/shared/validators";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projectInfraConfigs } from "../db/schema";
import { createAuditEntry } from "../middleware/audit";

export const projectInfraService = {
  /** Non-secret identifiers only — no credentials ever live on this row. */
  async get(projectId: string) {
    const [row] = await db
      .select()
      .from(projectInfraConfigs)
      .where(eq(projectInfraConfigs.projectId, projectId));
    return row ?? null;
  },

  async upsert(
    projectId: string,
    input: UpsertProjectInfraConfigInput,
    performedBy: string,
  ) {
    const [row] = await db
      .insert(projectInfraConfigs)
      .values({
        projectId,
        neonProjectId: input.neonProjectId,
        railwayProjectId: input.railwayProjectId,
        railwayServiceId: input.railwayServiceId,
        createdBy: performedBy,
      })
      .onConflictDoUpdate({
        target: projectInfraConfigs.projectId,
        set: {
          neonProjectId: input.neonProjectId,
          railwayProjectId: input.railwayProjectId,
          railwayServiceId: input.railwayServiceId,
          updatedAt: new Date(),
        },
      })
      .returning();

    await createAuditEntry({
      entityType: "project_infra_config",
      entityId: projectId,
      action: "create",
      newValue: {
        neonProjectId: input.neonProjectId ?? null,
        railwayProjectId: input.railwayProjectId ?? null,
        railwayServiceId: input.railwayServiceId ?? null,
      },
      performedBy,
    });

    return row;
  },
};
