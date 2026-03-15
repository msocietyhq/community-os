import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { reputationModel } from "./models/reputation";

export const reputationRoutes = new Elysia({ prefix: "/api/v1/reputation" })
  .use(authMiddleware)
  .use(reputationModel)
  .get(
    "/:userId",
    async ({ params: { userId } }) => {
      // TODO: Implement get reputation score
      return { userId, score: 0, events: [] };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Reputation"),
      detail: { tags: ["Reputation"], summary: "Get user reputation" },
    }
  )
  .get(
    "/leaderboard",
    async () => {
      // TODO: Implement leaderboard
      return { leaderboard: [] };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Reputation"),
      detail: { tags: ["Reputation"], summary: "Get reputation leaderboard" },
    }
  )
  .post(
    "/events",
    async ({ body, user }) => {
      // TODO: Implement create reputation event
      return { message: "Reputation event recorded" };
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Reputation"),
      body: "reputation.event.create",
      detail: { tags: ["Reputation"], summary: "Record reputation event" },
    }
  );
