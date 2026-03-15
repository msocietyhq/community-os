import { Elysia } from "elysia";
import { auth } from "../auth";
import { defineAbilityFor, isRole } from "@community-os/shared";

export const authMiddleware = new Elysia({ name: "auth-middleware" }).macro({
  auth: {
    async resolve({ status, request: { headers } }) {
      const session = await auth.api.getSession({ headers });

      if (!session) {
        return status(401, {
          error: {
            code: "UNAUTHORIZED",
            message: "Valid session required",
          },
        });
      }

      if (session.user.banned) {
        return status(403, {
          error: {
            code: "BANNED",
            message: "Your account has been suspended",
          },
        });
      }

      const role = session.user.role;
      if (!isRole(role)) {
        return status(403, {
          error: {
            code: "FORBIDDEN",
            message: "Invalid user role",
          },
        });
      }

      const ability = defineAbilityFor({
        id: session.user.id,
        role,
      });

      return {
        user: session.user,
        session: session.session,
        ability,
      };
    },
  },
});
