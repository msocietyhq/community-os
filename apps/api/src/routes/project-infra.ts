import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { checkPermissionOn } from "../middleware/permissions";
import { projectInfraService } from "../services/project-infra.service";
import { projectsService } from "../services/projects.service";
import { devEnvironmentModel } from "./models/dev-environment";

// Param name must match `projects.ts`'s own `:id` (not `:projectId`) — Eden
// Treaty merges plugins into one type tree by path, and a differently-named
// param at the same segment breaks that merge for every route under
// `/api/v1/projects/:id`, not just this file's.
const projectIdParams = z.object({ id: z.string().uuid() });

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
  );
