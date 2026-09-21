import type {
  CiPreviewEnvironmentInput,
  CreateDevEnvironmentInput,
} from "@community-os/shared/validators";
import { Elysia } from "elysia";
import { z } from "zod";
import { env } from "../env";
import { safeCompare } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { checkPermission, checkPermissionOn } from "../middleware/permissions";
import { agentKeysService } from "../services/agent-keys.service";
import { devEnvironmentsService } from "../services/dev-environments.service";
import { projectsService } from "../services/projects.service";
import { devEnvironmentModel } from "./models/dev-environment";

/**
 * Gates the CI-only ensure/teardown routes: one org-wide credential (not a
 * Better Auth session — GitHub Actions has none), inherited by every
 * endorsed project's reusable workflow. See issue #52.
 */
function requireCiServiceToken(headers: Record<string, string | undefined>) {
  const token = headers["x-ci-service-token"];
  if (!token) {
    throw new AppError(
      401,
      "MISSING_CI_TOKEN",
      "X-CI-Service-Token header required",
    );
  }
  if (!env.CI_SERVICE_TOKEN || !safeCompare(token, env.CI_SERVICE_TOKEN)) {
    throw new AppError(401, "INVALID_CI_TOKEN", "Invalid CI service token");
  }
}

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
  )
  .post(
    "/ci/ensure",
    async ({ headers, body }) => {
      requireCiServiceToken(headers);
      const input = body as CiPreviewEnvironmentInput;
      const project = await projectsService.findByRepoFullName(
        input.repoFullName,
      );
      const environment = await devEnvironmentsService.ensurePreviewEnvironment(
        {
          projectId: project.id,
          prNumber: input.prNumber,
          prAuthorGithubLogin: input.prAuthorGithubLogin,
        },
      );
      return { environmentId: environment.id };
    },
    {
      // Deliberately not `auth: true` — GitHub Actions has no Better Auth
      // session; the org-wide CI_SERVICE_TOKEN is the credential.
      body: "devEnvironment.ci.ensure",
      detail: {
        tags: ["Dev Environments"],
        summary:
          "CI-only: find-or-create the PR preview environment for a repo+PR (issue #52)",
      },
    },
  )
  .post(
    "/ci/teardown",
    async ({ headers, body }) => {
      requireCiServiceToken(headers);
      const input = body as CiPreviewEnvironmentInput;
      const project = await projectsService.findByRepoFullName(
        input.repoFullName,
      );
      await devEnvironmentsService.teardownPreviewEnvironment({
        projectId: project.id,
        prNumber: input.prNumber,
      });
      return { message: "Preview environment torn down" };
    },
    {
      body: "devEnvironment.ci.teardown",
      detail: {
        tags: ["Dev Environments"],
        summary:
          "CI-only: tear down the PR preview environment's Neon branch and Railway environment (issue #52)",
      },
    },
  );
