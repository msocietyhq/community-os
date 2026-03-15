import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { membersService } from "../services/members.service";
import { memberModel } from "./models/member";

export const memberRoutes = new Elysia({ prefix: "/api/v1/members" })
  .use(authMiddleware)
  .use(memberModel)
  .get(
    "/me",
    async ({ user }) => {
      const member = await membersService.findByUserId(user.id);
      return { user, member };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Member"),
      detail: { tags: ["Members"], summary: "Get current member profile" },
    }
  )
  .patch(
    "/me",
    async ({ user, body }) => {
      const updated = await membersService.update(user.id, body);
      return updated;
    },
    {
      auth: true,
      beforeHandle: checkPermission("update", "Member"),
      body: "member.update",
      detail: { tags: ["Members"], summary: "Update current member profile" },
    }
  )
  .get(
    "/",
    async ({ query }) => {
      return membersService.list(query);
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Member"),
      query: "member.listQuery",
      detail: { tags: ["Members"], summary: "Search and list members" },
    }
  )
  .get(
    "/:userId",
    async ({ params: { userId }, set }) => {
      const member = await membersService.findByUserId(userId);
      if (!member) {
        set.status = 404;
        return { message: "Member not found" };
      }
      return member;
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Member"),
      detail: { tags: ["Members"], summary: "Get member by user ID" },
    }
  );
