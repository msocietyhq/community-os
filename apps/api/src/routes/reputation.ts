import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { checkPermission } from "../middleware/permissions";
import { createAuditEntry } from "../middleware/audit";
import { reputationModel } from "./models/reputation";
import { reputationService } from "../services/reputation.service";

export const reputationRoutes = new Elysia({ prefix: "/api/v1/reputation" })
  .use(authMiddleware)
  .use(reputationModel)
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
  )
  .post(
    "/events",
    async ({ body, user }) => {
      const event = await reputationService.recordEvent(body);
      if (!event) {
        return { message: "Duplicate event or recording failed" };
      }
      createAuditEntry({
        entityType: "reputation",
        entityId: event.id,
        action: "create",
        newValue: event,
        performedBy: user.id,
      }).catch(console.error);
      return { message: "Reputation event recorded", event };
    },
    {
      auth: true,
      beforeHandle: checkPermission("create", "Reputation"),
      body: "reputation.event.create",
      detail: { tags: ["Reputation"], summary: "Record reputation event" },
    }
  );
