import type { UpsertProjectInfraConfigInput } from "@community-os/shared/validators";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projectInfraConfigs } from "../db/schema";
import { neonClient } from "../integrations/neon";
import { railwayClient } from "../integrations/railway";
import { createAuditEntry } from "../middleware/audit";
import { AppError } from "../lib/errors";

async function getRow(projectId: string) {
  const [row] = await db
    .select()
    .from(projectInfraConfigs)
    .where(eq(projectInfraConfigs.projectId, projectId));
  return row ?? null;
}

export const projectInfraService = {
  /** Non-secret identifiers only — no credentials ever live on this row. */
  async get(projectId: string) {
    return getRow(projectId);
  },

  /**
   * Merges `input` onto whatever's already stored — a partial call (e.g.
   * just `{ neonProjectId }` from the "link a Neon project" action) must
   * not blank out fields it didn't mention.
   */
  async upsert(
    projectId: string,
    input: UpsertProjectInfraConfigInput,
    performedBy: string,
  ) {
    const existing = await getRow(projectId);
    // `undefined` (key omitted) keeps the existing value; `null` clears it.
    const merged = {
      neonProjectId:
        input.neonProjectId === undefined
          ? (existing?.neonProjectId ?? null)
          : input.neonProjectId,
      railwayProjectId:
        input.railwayProjectId === undefined
          ? (existing?.railwayProjectId ?? null)
          : input.railwayProjectId,
      railwayServiceId:
        input.railwayServiceId === undefined
          ? (existing?.railwayServiceId ?? null)
          : input.railwayServiceId,
      railwaySourceEnvironmentId:
        input.railwaySourceEnvironmentId === undefined
          ? (existing?.railwaySourceEnvironmentId ?? null)
          : input.railwaySourceEnvironmentId,
    };

    const [row] = await db
      .insert(projectInfraConfigs)
      .values({ projectId, ...merged, createdBy: performedBy })
      .onConflictDoUpdate({
        target: projectInfraConfigs.projectId,
        set: { ...merged, updatedAt: new Date() },
      })
      .returning();

    await createAuditEntry({
      entityType: "project_infra_config",
      entityId: projectId,
      action: "create",
      newValue: merged,
      performedBy,
    });

    return row;
  },

  /** Every Neon project on this platform's account — for linking an existing one. */
  async listNeonProjects() {
    return neonClient.listProjects();
  },

  /** Creates a fresh Neon project and links it to `projectId` in one step. */
  async createAndLinkNeonProject(
    projectId: string,
    name: string,
    performedBy: string,
  ) {
    const project = await neonClient.createProject(name);
    await this.upsert(projectId, { neonProjectId: project.id }, performedBy);
    return project;
  },

  /** Every Railway project in this platform's workspace — for linking an existing one. */
  async listRailwayProjects() {
    return railwayClient.listProjects();
  },

  /** Creates a fresh Railway project and links it to `projectId` in one step. */
  async createAndLinkRailwayProject(
    projectId: string,
    name: string,
    performedBy: string,
  ) {
    const project = await railwayClient.createProject(name);
    await this.upsert(projectId, { railwayProjectId: project.id }, performedBy);
    return project;
  },

  /** Services in the Railway project already linked to `projectId` — for picking `railwayServiceId`. */
  async listRailwayServices(projectId: string) {
    const config = await getRow(projectId);
    if (!config?.railwayProjectId) {
      throw new AppError(
        400,
        "RAILWAY_PROJECT_NOT_LINKED",
        "Link a Railway project first",
      );
    }
    return railwayClient.listServices(config.railwayProjectId);
  },

  /** Environments in the Railway project already linked to `projectId` — for picking `railwaySourceEnvironmentId`. */
  async listRailwayEnvironments(projectId: string) {
    const config = await getRow(projectId);
    if (!config?.railwayProjectId) {
      throw new AppError(
        400,
        "RAILWAY_PROJECT_NOT_LINKED",
        "Link a Railway project first",
      );
    }
    return railwayClient.listEnvironments(config.railwayProjectId);
  },
};
