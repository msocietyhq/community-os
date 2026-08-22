import { eq, and, or, ilike, isNull, count, asc, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { members, MEMBER_SELF_COLUMNS } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { projects, projectMembers } from "../db/schema/projects";
import { bot } from "../bot/bot";
import { env } from "../env";
import { paginatedResult, listOffset } from "../lib/pagination";
import { isPresentChatMember } from "../lib/telegram-membership";
import { photoUrlSql } from "./photos.service";
import type {
  CreateMemberInput,
  MemberListQuery,
} from "@community-os/shared/validators";

export const membersService = {
  async findByUserId(userId: string) {
    const result = await db
      .select(MEMBER_SELF_COLUMNS)
      .from(members)
      .where(eq(members.userId, userId))
      .limit(1);
    return result[0] ?? null;
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
          // BM25 for members table fields (indexed, case-insensitive)
          sql`${members.bio} @@@ ${query.q}::text`,
          sql`${members.currentTitle} @@@ ${query.q}::text`,
          sql`${members.currentCompany} @@@ ${query.q}::text`,
          sql`${members.education} @@@ ${query.q}::text`,
          sql`${members.githubHandle} @@@ ${query.q}::text`,
          sql`${members.skills} @@@ ${query.q}::text`,
          sql`${members.interests} @@@ ${query.q}::text`,
          // ILIKE for user table fields (separate table, not in BM25 index)
          ilike(user.name, pattern),
          ilike(user.telegramUsername, pattern),
        )!,
      );
    }

    const skillsArr = query.skills
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (skillsArr?.length) {
      conditions.push(sql`${members.skills} @@@ ${skillsArr.join(" ")}::text`);
    }

    const interestsArr = query.interests
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (interestsArr?.length) {
      conditions.push(sql`${members.interests} @@@ ${interestsArr.join(" ")}::text`);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const offset = listOffset(query.page, query.limit);

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
            image: photoUrlSql(),
            role: user.role,
            banned: user.banned,
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

    return paginatedResult("members", memberList, query.page, query.limit, totalResult[0]?.total ?? 0);
  },

  async update(
    userId: string,
    data: {
      bio?: string;
      skills?: string[];
      interests?: string[];
      currentTitle?: string;
      currentCompany?: string;
      githubHandle?: string;
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

  async createIfNotExists(
    userId: string,
    opts?: { joinedAt?: Date },
  ): Promise<{ created: boolean }> {
    const [member] = await db
      .insert(members)
      .values({ userId, ...(opts?.joinedAt ? { joinedAt: opts.joinedAt } : {}) })
      .onConflictDoNothing({ target: members.userId })
      .returning();

    return { created: !!member };
  },

  /**
   * Whether a Telegram user is currently in the community group.
   *
   * Asks Telegram rather than inferring from our own tables: someone can be in
   * the group having never spoken (so no `telegram_messages` row), and someone
   * can have a long message history yet have left. `getChatMember` is the only
   * answer that is true at the moment we ask.
   *
   * Returns false when the group isn't configured or the call fails — callers
   * use this to decide who counts as a member, and guessing "yes" is what let
   * DM-only users be counted as members in the first place.
   */
  async isInGroup(telegramId: string | number): Promise<boolean> {
    if (!env.TELEGRAM_GROUP_ID) return false;

    try {
      return isPresentChatMember(
        await bot.api.getChatMember(env.TELEGRAM_GROUP_ID, Number(telegramId)),
      );
    } catch {
      // Unknown user in the chat, or a transient API failure.
      return false;
    }
  },

  /**
   * Claim the right to greet this member, exactly once.
   *
   * The `IS NULL` guard is in the UPDATE rather than a read-then-write so that
   * the `chat_member` and first-message paths racing on the same join cannot
   * both see "not yet welcomed" and both send a greeting.
   *
   * @returns true if the caller won the claim and should send the welcome.
   */
  async claimWelcome(userId: string): Promise<boolean> {
    const [claimed] = await db
      .update(members)
      .set({ welcomedAt: new Date() })
      .where(and(eq(members.userId, userId), isNull(members.welcomedAt)))
      .returning({ id: members.id });

    return !!claimed;
  },

  async findWithUser(userId: string) {
    const result = await db
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
        // For the AI-only GraphQL Member type. Deliberately absent from
        // findByUsername and list, which back public REST routes.
        aiSummary: members.aiSummary,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: photoUrlSql(),
          role: user.role,
          banned: user.banned,
          telegramUsername: user.telegramUsername,
          telegramId: user.telegramId,
        },
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(eq(members.userId, userId))
      .limit(1);

    return result[0] ?? null;
  },

  async findByUsername(username: string) {
    const result = await db
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
          image: photoUrlSql(),
          role: user.role,
          telegramUsername: user.telegramUsername,
        },
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(ilike(user.telegramUsername, username))
      .limit(1);

    if (!result[0]) return null;

    const member = result[0];

    const memberProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        nature: projects.nature,
        platforms: projects.platforms,
        status: projects.status,
        url: projects.url,
        repoUrl: projects.repoUrl,
        isEndorsed: projects.isEndorsed,
        role: projectMembers.role,
        createdAt: projects.createdAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          eq(projectMembers.userId, member.userId),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(projects.createdAt));

    return { ...member, projects: memberProjects };
  },

  async ban(userId: string, opts?: { skipTelegram?: boolean }) {
    const [updated] = await db
      .update(user)
      .set({ banned: true, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning();

    if (!opts?.skipTelegram && updated?.telegramId && env.TELEGRAM_GROUP_ID) {
      await bot.api
        .banChatMember(env.TELEGRAM_GROUP_ID, Number(updated.telegramId))
        .catch(console.error);
    }

    return updated ?? null;
  },

  async unban(userId: string, opts?: { skipTelegram?: boolean }) {
    const [updated] = await db
      .update(user)
      .set({ banned: false, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning();

    if (!opts?.skipTelegram && updated?.telegramId && env.TELEGRAM_GROUP_ID) {
      await bot.api
        .unbanChatMember(env.TELEGRAM_GROUP_ID, Number(updated.telegramId))
        .catch(console.error);
    }

    return updated ?? null;
  },

  async changeRole(userId: string, role: string) {
    const [updated] = await db
      .update(user)
      .set({ role, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning();

    return updated ?? null;
  },
};
