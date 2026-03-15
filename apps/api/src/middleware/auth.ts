import { Elysia } from "elysia";
import { auth } from "../auth";

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

      return {
        user: session.user,
        session: session.session,
      };
    },
  },
});
