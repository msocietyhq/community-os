import { Elysia } from "elysia";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { secretsService } from "../services/secrets.service";
import { infraModel } from "./models/infra";

const resourceParams = z.object({ resourceId: z.string().min(1) });
const resourceKeyParams = z.object({
  resourceId: z.string().min(1),
  key: z.string().min(1),
});

export const infraRoutes = new Elysia({ prefix: "/api/v1/infra" })
  .use(authMiddleware)
  .use(infraModel)
  .get(
    "/services",
    async () => {
      // TODO: Implement list infra services
      return { services: [] };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Infra"),
      detail: {
        tags: ["Infrastructure"],
        summary: "List infrastructure services",
      },
    },
  )
  .post(
    "/provision",
    async () => {
      // TODO: Implement resource provisioning
      return { message: "Provisioning started" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      detail: { tags: ["Infrastructure"], summary: "Provision resource" },
    },
  )
  .post(
    "/subdomains",
    async () => {
      // TODO: Implement subdomain creation
      return { message: "Subdomain created" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      detail: { tags: ["Infrastructure"], summary: "Create subdomain" },
    },
  )
  .get(
    "/resources/:resourceId/secrets",
    async ({ params: { resourceId } }) => {
      const secrets = await secretsService.list(resourceId);
      return { secrets };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Infra"),
      params: resourceParams,
      detail: {
        tags: ["Infrastructure"],
        summary:
          "List secret keys for a provisioned resource (metadata only, never values)",
      },
    },
  )
  .put(
    "/resources/:resourceId/secrets/:key",
    async ({ params: { resourceId, key }, body, user }) => {
      return secretsService.store({
        provisionedResourceId: resourceId,
        key,
        value: body.value,
        performedBy: user.id,
      });
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      params: resourceKeyParams,
      body: "infra.secret.store",
      detail: {
        tags: ["Infrastructure"],
        summary: "Store or rotate a resource secret",
      },
    },
  )
  .post(
    "/resources/:resourceId/secrets/:key/reveal",
    async ({ params: { resourceId, key }, user }) => {
      return secretsService.reveal({
        provisionedResourceId: resourceId,
        key,
        performedBy: user.id,
      });
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      params: resourceKeyParams,
      detail: {
        tags: ["Infrastructure"],
        summary: "Reveal a resource secret's plaintext value (audited)",
      },
    },
  )
  .delete(
    "/resources/:resourceId/secrets/:key",
    async ({ params: { resourceId, key }, user }) => {
      await secretsService.delete({
        provisionedResourceId: resourceId,
        key,
        performedBy: user.id,
      });
      return { message: "Secret deleted" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      params: resourceKeyParams,
      detail: { tags: ["Infrastructure"], summary: "Delete a resource secret" },
    },
  );
