import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { checkPermissionOn } from "../middleware/permissions";
import { projectBootstrapTokensService } from "../services/project-bootstrap-tokens.service";
import { projectInfraService } from "../services/project-infra.service";
import { projectsService } from "../services/projects.service";
import { devEnvironmentModel } from "./models/dev-environment";

// Param name must match `projects.ts`'s own `:id` (not `:projectId`) — Eden
// Treaty merges plugins into one type tree by path, and a differently-named
// param at the same segment breaks that merge for every route under
// `/api/v1/projects/:id`, not just this file's.
const projectIdParams = z.object({ id: z.string().uuid() });
const tokenParams = z.object({
  id: z.string().uuid(),
  tokenId: z.string().min(1),
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
          "Set which Neon/Railway project backs this project's PR previews",
      },
    },
  )
  .post(
    "/bootstrap-tokens",
    async ({ params: { id }, body, user }) =>
      projectBootstrapTokensService.issue(id, body, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("issue", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      body: "projectBootstrapToken.issue",
      detail: {
        tags: ["Project Infra"],
        summary:
          "Mint the bootstrap token this project's Railway service clones into every PR environment",
      },
    },
  )
  .get(
    "/bootstrap-tokens",
    async ({ params: { id } }) => ({
      tokens: await projectBootstrapTokensService.list(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: projectIdParams,
      detail: {
        tags: ["Project Infra"],
        summary: "List a project's bootstrap tokens (metadata only)",
      },
    },
  )
  .post(
    "/bootstrap-tokens/:tokenId/revoke",
    async ({ params: { tokenId }, user }) =>
      projectBootstrapTokensService.revoke(tokenId, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("revoke", ({ params, user }) =>
        resolveProjectInfraSubject(params.id, user.id),
      ),
      params: tokenParams,
      detail: {
        tags: ["Project Infra"],
        summary: "Revoke a bootstrap token",
      },
    },
  );
