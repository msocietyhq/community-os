import { Elysia } from "elysia";
import { PERMISSIONS, type Permission, type Role } from "@community-os/shared";

export function requirePermission(permission: Permission) {
  return new Elysia({ name: `permission-${permission}` }).derive(
    ({ store }) => {
      const user = (store as { user?: { role: string } }).user;
      if (!user) {
        throw new Error("Auth middleware must be applied before permissions");
      }

      const allowedRoles: readonly string[] = PERMISSIONS[permission];
      if (!allowedRoles.includes(user.role)) {
        throw new Error(`Insufficient permissions: ${permission} required`);
      }

      return {};
    }
  );
}
