import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";

export const infraRoutes = new Elysia({ prefix: "/api/v1/infra" })
  .use(authMiddleware)
  .get(
    "/services",
    async () => {
      // TODO: Implement list infra services
      return { services: [] };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Infra"),
      detail: { tags: ["Infrastructure"], summary: "List infrastructure services" },
    }
  )
  .post(
    "/provision",
    async ({ body, user }) => {
      // TODO: Implement resource provisioning
      return { message: "Provisioning started" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      detail: { tags: ["Infrastructure"], summary: "Provision resource" },
    }
  )
  .post(
    "/subdomains",
    async ({ body, user }) => {
      // TODO: Implement subdomain creation
      return { message: "Subdomain created" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("provision", "Infra"),
      detail: { tags: ["Infrastructure"], summary: "Create subdomain" },
    }
  );
