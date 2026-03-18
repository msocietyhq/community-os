import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { reputationService } from "../services/reputation.service";

export const reputationRoutes = new Elysia({ prefix: "/api/v1/reputation" })
  .use(authMiddleware)
  .get(
    "/leaderboard",
    async () => {
      const leaderboard = await reputationService.getLeaderboard(10);
      return { leaderboard };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Reputation"),
      detail: { tags: ["Reputation"], summary: "Get reputation leaderboard" },
    }
  )
  .get(
    "/:userId",
    async ({ params: { userId } }) => {
      const [score, events] = await Promise.all([
        reputationService.getScore(userId),
        reputationService.getEvents(userId),
      ]);
      return { userId, score, events };
    },
    {
      auth: true,
      beforeHandle: checkPermission("read", "Reputation"),
      detail: { tags: ["Reputation"], summary: "Get user reputation" },
    }
  );
