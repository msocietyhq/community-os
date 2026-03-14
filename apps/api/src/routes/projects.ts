import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { projects } from "../db/schema/projects";

type Project = typeof projects.$inferSelect;

export const projectRoutes = new Elysia({ prefix: "/api/v1/projects" })
  .use(authMiddleware)
  .get(
    "/",
    async () => {
      // TODO: Implement project listing
      return { projects: [] as Project[], total: 0 };
    },
    {
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
      detail: { tags: ["Projects"], summary: "Endorse project" },
    }
  );
