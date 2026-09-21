import type { CreateSharedSecretInput } from "@community-os/shared/validators";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../db";
import { sharedSecrets } from "../db/schema";
import { AppError } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { checkPermissionOn } from "../middleware/permissions";
import { projectsService } from "../services/projects.service";
import { sharedSecretsService } from "../services/shared-secrets.service";
import { devEnvironmentModel } from "./models/dev-environment";

const idParams = z.object({ id: z.string().min(1) });
const projectQuery = z.object({ projectId: z.string().uuid() });

async function resolveSharedSecretSubject(
  id: string | undefined,
  userId: string,
) {
  if (!id) return null;
  const [row] = await db
    .select({ projectId: sharedSecrets.projectId })
    .from(sharedSecrets)
    .where(eq(sharedSecrets.id, id));

  if (!row) {
    throw new AppError(
      404,
      "SHARED_SECRET_NOT_FOUND",
      "Shared secret not found",
    );
  }

  const projectRole = await projectsService.getMemberRole(
    row.projectId,
    userId,
  );
  return { __caslSubjectType__: "SharedSecret" as const, projectRole };
}

export const sharedSecretRoutes = new Elysia({
  prefix: "/api/v1/shared-secrets",
})
  .use(authMiddleware)
  .use(devEnvironmentModel)
  .get(
    "/",
    async ({ query }) => ({
      secrets: await sharedSecretsService.list(query.projectId),
    }),
    {
      auth: true,
      beforeHandle: checkPermissionOn("read", async ({ query, user }) => {
        const { projectId } = query as { projectId: string };
        const projectRole = await projectsService.getMemberRole(
          projectId,
          user.id,
        );
        return { __caslSubjectType__: "SharedSecret" as const, projectRole };
      }),
      query: projectQuery,
      detail: {
        tags: ["Shared Secrets"],
        summary:
          "List a project's shared secrets (metadata only, never values)",
      },
    },
  )
  .post(
    "/",
    async ({ body, user }) => sharedSecretsService.create(body, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("create", async ({ body, user }) => {
        const input = body as CreateSharedSecretInput;
        const projectRole = await projectsService.getMemberRole(
          input.projectId,
          user.id,
        );
        return { __caslSubjectType__: "SharedSecret" as const, projectRole };
      }),
      body: "sharedSecret.create",
      detail: {
        tags: ["Shared Secrets"],
        summary: "Create a project-wide shared secret",
      },
    },
  )
  .post(
    "/:id/rotate",
    async ({ params: { id }, body, user }) =>
      sharedSecretsService.rotate(id, body, user.id),
    {
      auth: true,
      beforeHandle: checkPermissionOn("update", ({ params, user }) =>
        resolveSharedSecretSubject(params.id, user.id),
      ),
      params: idParams,
      body: "sharedSecret.rotate",
      detail: {
        tags: ["Shared Secrets"],
        summary: "Rotate a shared secret's value",
      },
    },
  )
  .delete(
    "/:id",
    async ({ params: { id }, user }) => {
      await sharedSecretsService.delete(id, user.id);
      return { message: "Shared secret deleted" };
    },
    {
      auth: true,
      beforeHandle: checkPermissionOn("delete", ({ params, user }) =>
        resolveSharedSecretSubject(params.id, user.id),
      ),
      params: idParams,
      detail: { tags: ["Shared Secrets"], summary: "Delete a shared secret" },
    },
  );
