import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { membersService } from "../services/members.service";
import { memberModel } from "./models/member";
import { ROLE_HIERARCHY, type Role } from "@community-os/shared";

export const memberRoutes = new Elysia({ prefix: "/api/v1/members" })
  .use(authMiddleware)
  .use(memberModel)
  .get(
    "/me",
    async ({ user }) => {
      let member = await membersService.findByUserId(user.id);
      if (!member) {
        await membersService.createIfNotExists(user.id);
        member = await membersService.findByUserId(user.id);
      }
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
      const oldMember = await membersService.findByUserId(user.id);
      const updated = await membersService.update(user.id, body);
      createAuditEntry({
        entityType: "member",
        entityId: user.id,
        action: "update",
        oldValue: oldMember,
        newValue: updated,
        performedBy: user.id,
      }).catch(console.error);
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
      const member = await membersService.findWithUser(userId);
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
  )
  .patch(
    "/:userId/ban",
    async ({ params: { userId }, user, body, set }) => {
      const target = await membersService.findWithUser(userId);
      if (!target) {
        set.status = 404;
        return { message: "Member not found" };
      }

      if (userId === user.id) {
        set.status = 403;
        return { message: "Cannot ban yourself" };
      }

      const callerLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
      const targetLevel =
        ROLE_HIERARCHY[target.user.role as Role] ?? 0;
      if (targetLevel >= callerLevel) {
        set.status = 403;
        return { message: "Cannot ban a user with equal or higher role" };
      }

      if (target.user.banned) {
        set.status = 409;
        return { message: "User is already banned" };
      }

      const updated = await membersService.ban(userId);

      createAuditEntry({
        entityType: "member",
        entityId: userId,
        action: "ban",
        newValue: { banned: true, reason: body.reason },
        performedBy: user.id,
      }).catch(console.error);

      return updated;
    },
    {
      auth: true,
      beforeHandle: checkPermission("ban", "Member"),
      body: "member.ban",
      detail: { tags: ["Members"], summary: "Ban a member" },
    }
  )
  .patch(
    "/:userId/unban",
    async ({ params: { userId }, user, set }) => {
      const target = await membersService.findWithUser(userId);
      if (!target) {
        set.status = 404;
        return { message: "Member not found" };
      }

      if (!target.user.banned) {
        set.status = 409;
        return { message: "User is not banned" };
      }

      const updated = await membersService.unban(userId);

      createAuditEntry({
        entityType: "member",
        entityId: userId,
        action: "unban",
        newValue: { banned: false },
        performedBy: user.id,
      }).catch(console.error);

      return updated;
    },
    {
      auth: true,
      beforeHandle: checkPermission("ban", "Member"),
      detail: { tags: ["Members"], summary: "Unban a member" },
    }
  )
  .patch(
    "/:userId/role",
    async ({ params: { userId }, user, body, set }) => {
      const target = await membersService.findWithUser(userId);
      if (!target) {
        set.status = 404;
        return { message: "Member not found" };
      }

      if (userId === user.id) {
        set.status = 403;
        return { message: "Cannot change your own role" };
      }

      if (target.user.role === body.role) {
        set.status = 409;
        return { message: `User already has the role "${body.role}"` };
      }

      const oldRole = target.user.role;
      const updated = await membersService.changeRole(userId, body.role);

      createAuditEntry({
        entityType: "member",
        entityId: userId,
        action: "role_change",
        oldValue: { role: oldRole },
        newValue: { role: body.role },
        performedBy: user.id,
      }).catch(console.error);

      return updated;
    },
    {
      auth: true,
      beforeHandle: checkPermission("manage_role", "Member"),
      body: "member.changeRole",
      detail: { tags: ["Members"], summary: "Change a member's role" },
    }
  );
