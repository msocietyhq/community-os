import { Elysia } from "elysia";
import { PERMISSIONS, type Permission, type Role } from "@community-os/shared";
import { ForbiddenError, InternalError } from "../lib/errors";

export function requirePermission(permission: Permission) {
  return new Elysia({ name: `permission-${permission}` }).derive(
    ({ store }) => {
      const user = (store as { user?: { role: string } }).user;
      if (!user) {
        throw new InternalError("Auth middleware must be applied before permissions");
      }

      const allowedRoles: readonly string[] = PERMISSIONS[permission];
      if (!allowedRoles.includes(user.role)) {
        throw new ForbiddenError(`Insufficient permissions: ${permission} required`);
      }

      return {};
    }
  );
}
