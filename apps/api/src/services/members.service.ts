import { eq, and, or, ilike, count, asc, sql } from "drizzle-orm";
import { db } from "../db";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import type {
  CreateMemberInput,
  MemberListQuery,
} from "@community-os/shared/validators";

export const membersService = {
  async findByUserId(userId: string) {
    const member = await db.query.members.findFirst({
      where: eq(members.userId, userId),
    });
    return member ?? null;
  },

  async list(query: MemberListQuery) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (query.role) {
      conditions.push(eq(user.role, query.role));
    }

    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(
          ilike(user.name, pattern),
          ilike(members.bio, pattern),
          ilike(members.currentTitle, pattern),
          ilike(members.currentCompany, pattern),
          ilike(members.education, pattern),
          ilike(members.githubHandle, pattern),
          ilike(user.telegramUsername, pattern),
        )!,
      );
    }

    const skillsArr = query.skills
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (skillsArr?.length) {
      conditions.push(
        sql`${members.skills} && ARRAY[${sql.join(
          skillsArr.map((s) => sql`${s}`),
          sql`,`,
        )}]::text[]`,
      );
    }

    const interestsArr = query.interests
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (interestsArr?.length) {
      conditions.push(
        sql`${members.interests} && ARRAY[${sql.join(
          interestsArr.map((i) => sql`${i}`),
          sql`,`,
        )}]::text[]`,
      );
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [memberList, totalResult] = await Promise.all([
      db
        .select({
          id: members.id,
          userId: members.userId,
          githubHandle: members.githubHandle,
          bio: members.bio,
          skills: members.skills,
          interests: members.interests,
          currentCompany: members.currentCompany,
          currentTitle: members.currentTitle,
          education: members.education,
          linkedinUrl: members.linkedinUrl,
          websiteUrl: members.websiteUrl,
          joinedAt: members.joinedAt,
          user: {
            id: user.id,
            name: user.name,
            image: user.image,
            telegramUsername: user.telegramUsername,
          },
        })
        .from(members)
        .innerJoin(user, eq(members.userId, user.id))
        .where(where)
        .orderBy(asc(members.joinedAt))
        .limit(query.limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(members)
        .innerJoin(user, eq(members.userId, user.id))
        .where(where),
    ]);

    return { members: memberList, total: totalResult[0]?.total ?? 0 };
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

  async createIfNotExists(userId: string): Promise<{ created: boolean }> {
    const [member] = await db
      .insert(members)
      .values({ userId })
      .onConflictDoNothing({ target: members.userId })
      .returning();

    return { created: !!member };
  },
};
