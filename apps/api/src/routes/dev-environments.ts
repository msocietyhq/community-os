import type { CreateDevEnvironmentInput } from "@community-os/shared/validators";
import { Elysia } from "elysia";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { checkPermission, checkPermissionOn } from "../middleware/permissions";
import { agentKeysService } from "../services/agent-keys.service";
import { devEnvironmentsService } from "../services/dev-environments.service";
import { projectsService } from "../services/projects.service";
import { devEnvironmentModel } from "./models/dev-environment";

const idParams = z.object({ id: z.string().min(1) });
const envKeyParams = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
});
const agentKeyParams = z.object({
  id: z.string().min(1),
  keyId: z.string().min(1),
});
const projectQuery = z.object({ projectId: z.string().uuid() });

/** Tags an environment as a CASL subject: its own owner, plus the caller's project role. */
async function resolveEnvironmentSubject(
  environmentId: string | undefined,
  userId: string,
) {
  if (!environmentId) return null;
  const environment = await devEnvironmentsService.getById(environmentId);
  const projectRole = await projectsService.getMemberRole(
    environment.projectId,
    userId,
  );

  return {
    __caslSubjectType__: "DevEnvironment" as const,
    ownerId: environment.ownerId,
    projectRole,
  };
}

export const devEnvironmentRoutes = new Elysia({
  prefix: "/api/v1/dev-environments",
})
  .use(authMiddleware)
  .use(devEnvironmentModel)
  .post(
    "/",
    async ({ body, user }) => {
      return devEnvironmentsService.create({
        projectId: body.projectId,
        ownerId: user.id,
        label: body.label,
      });
    },
    {
      auth: true,
      // No coarse checkPermission here — "create" is only meaningful once we
      // know the actual project, which checkPermissionOn resolves from the
      // body (Elysia has already validated it by this point).
      beforeHandle: checkPermissionOn("create", async ({ user, body }) => {
        const input = body as CreateDevEnvironmentInput;
        const projectRole = await projectsService.getMemberRole(
          input.projectId,
          user.id,
        );
        return {
          __caslSubjectType__: "DevEnvironment" as const,
          ownerId: user.id,
          projectRole,
        };
      }),
      body: "devEnvironment.create",
      detail: {
        tags: ["Dev Environments"],
        summary: "Create a dev/agent environment for a project",
      },
    },
  )
  .get(
    "/",
    async ({ query, user }) => {
      const projectRole = await projectsService.getMemberRole(
        query.projectId,
        user.id,
      );
      const canSeeAll = projectRole === "owner" || projectRole === "maintainer";
      const environments = await devEnvironmentsService.list(query.projectId, {
        id: user.id,
        canSeeAll,
      });
      return { environments };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "DevEnvironment"),
      query: projectQuery,
      detail: {
        tags: ["Dev Environments"],
        summary:
          "List dev environments for a project (own, or all if maintainer+)",
      },
    },
  )
  .get(
    "/:id",
    async ({ params: { id } }) => devEnvironmentsService.getById(id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      detail: { tags: ["Dev Environments"], summary: "Get a dev environment" },
    },
  )
  .post(
    "/:id/revoke",
    async ({ params: { id }, user }) =>
      devEnvironmentsService.revoke(id, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("revoke", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      detail: {
        tags: ["Dev Environments"],
        summary: "Revoke a dev environment",
      },
    },
  )
  .get(
    "/:id/vars",
    async ({ params: { id } }) => ({
      vars: await devEnvironmentsService.listVars(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      detail: {
        tags: ["Dev Environments"],
        summary: "List env var keys for an environment (metadata only)",
      },
    },
  )
  .put(
    "/:id/vars/:key",
    async ({ params: { id, key }, body, user }) =>
      devEnvironmentsService.storeVar({
        environmentId: id,
        key,
        value: body.value,
        performedBy: user.id,
      }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: envKeyParams,
      body: "devEnvironment.var.store",
      detail: {
        tags: ["Dev Environments"],
        summary:
          "Manually set a generated env var (stand-in until Neon branch provisioning is wired up)",
      },
    },
  )
  .post(
    "/:id/reveal",
    async ({ params: { id }, user }) =>
      devEnvironmentsService.reveal(id, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      detail: {
        tags: ["Dev Environments"],
        summary: "Reveal an environment's full env var bundle (audited)",
      },
    },
  )
  .post(
    "/:id/agent-keys",
    async ({ params: { id }, body, user }) =>
      agentKeysService.issue(id, body, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("issue", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      body: "devEnvironment.agentKey.issue",
      detail: {
        tags: ["Dev Environments"],
        summary: "Mint an ephemeral agent key for this environment",
      },
    },
  )
  .get(
    "/:id/agent-keys",
    async ({ params: { id } }) => ({
      agentKeys: await agentKeysService.list(id),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: idParams,
      detail: {
        tags: ["Dev Environments"],
        summary: "List agent keys for an environment (metadata only)",
      },
    },
  )
  .post(
    "/:id/agent-keys/:keyId/revoke",
    async ({ params: { keyId }, user }) =>
      agentKeysService.revoke(keyId, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("revoke", ({ params, user }) =>
        resolveEnvironmentSubject(params.id, user.id),
      ),
      params: agentKeyParams,
      detail: { tags: ["Dev Environments"], summary: "Revoke an agent key" },
    },
  )
  .post(
    "/agent-keys/redeem",
    async ({ headers }) => {
      const token = headers["x-agent-key"];
      if (!token) {
        throw new AppError(
          401,
          "MISSING_AGENT_KEY",
          "X-Agent-Key header required",
        );
      }
      return agentKeysService.redeem(token);
    },
    {
      // Deliberately not `auth: true` — an agent has no Better Auth session;
      // the key itself, checked inside redeem(), is the credential.
      detail: {
        tags: ["Dev Environments"],
        summary: "Redeem an agent key for its environment's env var bundle",
      },
    },
  );
