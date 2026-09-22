import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { checkPermissionOn } from "../middleware/permissions";
import { auditLogService } from "../services/audit-log.service";
import { projectInfraService } from "../services/project-infra.service";
import { projectsService } from "../services/projects.service";
import { usageService } from "../services/usage.service";
import { devEnvironmentModel } from "./models/dev-environment";

// Param name must match `projects.ts`'s own `:id` (not `:projectId`) — Eden
// Treaty merges plugins into one type tree by path, and a differently-named
// param at the same segment breaks that merge for every route under
// `/api/v1/projects/:id`, not just this file's.
const projectIdParams = z.object({ id: z.string().uuid() });
const usageQuery = z.object({
  sinceDays: z.coerce.number().int().positive().max(365).default(30),
});

async function resolveProjectInfraSubject(
  projectId: string | undefined,
  userId: string,
) {
  if (!projectId) return null;
  const projectRole = await projectsService.getMemberRole(projectId, userId);
  return { __caslSubjectType__: "ProjectInfraConfig" as const, projectRole };
}

export const projectInfraRoutes = new Elysia({
  prefix: "/api/v1/projects/:id/infra-config",
})
  .use(authMiddleware)
  .use(devEnvironmentModel)
  .get(
    "/",
    async ({ params: { id } }) => ({
      config: await projectInfraService.get(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "Get a project's PR-preview infra config (Neon/Railway identifiers, never credentials)",
      },
    },
  )
  .put(
    "/",
    async ({ params: { id }, body, user }) =>
      projectInfraService.upsert(id, body, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      body: "projectInfraConfig.upsert",
      detail: {
        tags: ["Project Infra"],
        summary:
          "Set which Neon/Railway project (and service/environment) backs this project's PR previews",
      },
    },
  )
  .get(
    "/neon-projects",
    async () => ({ projects: await projectInfraService.listNeonProjects() }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "List Neon projects available to link (this platform's Neon account)",
      },
    },
  )
  .post(
    "/neon-projects",
    async ({ params: { id }, body, user }) =>
      projectInfraService.createAndLinkNeonProject(id, body.name, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      body: "neonProject.create",
      detail: {
        tags: ["Project Infra"],
        summary: "Create a new Neon project and link it to this project",
      },
    },
  )
  .get(
    "/railway-projects",
    async () => ({
      projects: await projectInfraService.listRailwayProjects(),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "List Railway projects available to link (this platform's Railway workspace)",
      },
    },
  )
  .post(
    "/railway-projects",
    async ({ params: { id }, body, user }) =>
      projectInfraService.createAndLinkRailwayProject(id, body.name, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      body: "railwayProject.create",
      detail: {
        tags: ["Project Infra"],
        summary: "Create a new Railway project and link it to this project",
      },
    },
  )
  .get(
    "/railway-services",
    async ({ params: { id } }) => ({
      services: await projectInfraService.listRailwayServices(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "List services in the linked Railway project (to pick which one deploys PR previews)",
      },
    },
  )
  .get(
    "/railway-environments",
    async ({ params: { id } }) => ({
      environments: await projectInfraService.listRailwayEnvironments(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "List environments in the linked Railway project (to pick which one PR previews clone from)",
      },
    },
  )
  .get(
    "/railway-variables",
    async ({ params: { id } }) => ({
      variableNames: await projectInfraService.listRailwayVariableNames(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "Variable names (never values) the linked source environment already has — to decide which to override via a shared secret",
      },
    },
  )
  .get(
    "/usage",
    async ({ params: { id }, query }) => ({
      environments: await usageService.getUsageSummary(id, query.sinceDays),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      query: usageQuery,
      detail: {
        tags: ["Project Infra"],
        summary:
          "Per-environment Neon consumption over a trailing window (raw provider metrics, no dollar conversion — see ADR-010)",
      },
    },
  )
  .post(
    "/usage/refresh",
    async ({ params: { id } }) => ({
      metricsStored: await usageService.collectNeonUsageForProject(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "On-demand pull of this project's Neon consumption metrics (normally runs nightly)",
      },
    },
  )
  .get(
    "/activity",
    async ({ params: { id } }) => ({
      entries: await auditLogService.listForProjectInfra(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary:
          "Recent audit trail for this project's infra config and dev environments",
      },
    },
  );
