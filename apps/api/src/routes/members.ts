import { Elysia, t } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { db } from "../db";
import { members } from "../db/schema";
import { eq } from "drizzle-orm";

export const memberRoutes = new Elysia({ prefix: "/api/v1/members" })
  .use(authMiddleware)
  .get(
    "/me",
    async ({ user }) => {
      const member = await db.query.members.findFirst({
        where: eq(members.userId, user.id),
      });
      return { user, member };
    },
    {
      auth: true,
      detail: { tags: ["Members"], summary: "Get current member profile" },
    }
  )
  .patch(
    "/me",
    async ({ user, body }) => {
      const [updated] = await db
        .update(members)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(members.userId, user.id))
        .returning();
      return updated;
    },
    {
      auth: true,
      body: t.Partial(
        t.Object({
          telegram_username: t.String(),
          github_handle: t.String(),
          phone_number: t.String(),
          bio: t.String(),
          skills: t.Array(t.String()),
          interests: t.Array(t.String()),
          current_company: t.String(),
          current_title: t.String(),
          education: t.String(),
          linkedin_url: t.String(),
          website_url: t.String(),
        })
      ),
      detail: { tags: ["Members"], summary: "Update current member profile" },
    }
  )
  .get(
    "/",
    async () => {
      const allMembers = await db.query.members.findMany();
      return allMembers;
    },
    {
      auth: true,
      detail: { tags: ["Members"], summary: "List all members" },
    }
  );
