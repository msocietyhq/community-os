import { eq } from "drizzle-orm";
import { db } from "../db";
import { members } from "../db/schema/members";
import type { CreateMemberInput } from "@community-os/shared/validators";

export const membersService = {
  async findByUserId(userId: string) {
    const member = await db.query.members.findFirst({
      where: eq(members.userId, userId),
    });
    return member ?? null;
  },

  async update(
    userId: string,
    data: {
      bio?: string;
      skills?: string[];
      interests?: string[];
      currentTitle?: string;
      currentCompany?: string;
    },
  ) {
    const [updated] = await db
      .update(members)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(members.userId, userId))
      .returning();
    return updated ?? null;
  },

  async create(userId: string, data: CreateMemberInput) {
    const [member] = await db
      .insert(members)
      .values({
        userId,
        bio: data.bio,
        currentTitle: data.currentTitle,
        currentCompany: data.currentCompany,
        skills: data.skills,
        interests: data.interests,
        githubHandle: data.githubHandle,
      })
      .returning();

    return member;
  },
};
