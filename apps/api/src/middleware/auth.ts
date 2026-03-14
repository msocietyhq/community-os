import { Elysia } from "elysia";
import { auth } from "../auth";

export const authMiddleware = new Elysia({ name: "auth-middleware" }).macro({
  auth: {
    async resolve({ headers, status }) {
      const session = await auth.api.getSession({
        headers: new Headers(headers as Record<string, string>),
      });

      if (!session) {
        return status(401, {
          error: "Unauthorized",
          message: "Valid session required",
        });
      }

      return {
        user: session.user,
        session: session.session,
      };
    },
  },
});
