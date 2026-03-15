import { Elysia } from "elysia";
import { PERMISSIONS, type Permission } from "@community-os/shared";
import { authMiddleware } from "./auth";

export function requirePermission(permission: Permission) {
  return new Elysia({ name: `permission-${permission}` })
    .use(authMiddleware)
    .guard({ auth: true })
    .onBeforeHandle(({ user, status }) => {
      const allowedRoles: readonly string[] = PERMISSIONS[permission];
      if (!allowedRoles.includes(user.role)) {
        return status(403, {
          error: {
            code: "FORBIDDEN",
            message: `Insufficient permissions: ${permission} required`,
          },
        });
      }
    });
}
