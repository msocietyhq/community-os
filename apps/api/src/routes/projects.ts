import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { projects } from "../db/schema/projects";
import { projectModel } from "./models/project";

type Project = typeof projects.$inferSelect;

export const projectRoutes = new Elysia({ prefix: "/api/v1/projects" })
  .use(authMiddleware)
  .use(projectModel)
  .get(
    "/",
    async () => {
      // TODO: Implement project listing
      return { projects: [] as Project[], total: 0 };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Project"),
      detail: { tags: ["Projects"], summary: "List projects" },
    }
  )
  .get(
    "/:id",
    async ({ params: { id } }) => {
      // TODO: Implement get project by ID
      return { id };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Project"),
      detail: { tags: ["Projects"], summary: "Get project by ID" },
    }
  )
  .post(
    "/",
    async ({ body, user }) => {
      // TODO: Implement project creation
      return { message: "Project created" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Project"),
      body: "project.create",
      detail: { tags: ["Projects"], summary: "Create project" },
    }
  )
  .post(
    "/:id/members",
    async ({ params: { id }, body, user }) => {
      // TODO: Implement add project member
      return { message: "Member added" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("update", "Project"),
      body: "project.member.add",
      detail: { tags: ["Projects"], summary: "Add project member" },
    }
  )
  .post(
    "/:id/endorse",
    async ({ params: { id }, user }) => {
      // TODO: Implement project endorsement
      return { message: "Project endorsed" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("endorse", "Project"),
      detail: { tags: ["Projects"], summary: "Endorse project" },
    }
  );
