import {
  eq,
  and,
  gte,
  isNull,
  isNotNull,
  count,
  desc,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { projects, projectMembers } from "../db/schema/projects";
import { eventsService } from "./events.service";
import { reputationService } from "./reputation.service";
import { env } from "../env";

export interface WeeklyDigest {
  periodStart: Date;
  periodEnd: Date;
  totalMessages: number;
  uniqueActiveMembers: number;
  topContributors: {
    fromUserId: number;
    fromUsername: string | null;
    fromFirstName: string | null;
    messageCount: number;
  }[];
  newMembers: { name: string; telegramUsername: string | null }[];
  upcomingEvents: Awaited<ReturnType<typeof eventsService.listUpcoming>>;
  newProjects: {
    name: string;
    ownerName: string | null;
    ownerTelegramUsername: string | null;
  }[];
  reputationLeaders: {
    userId: string;
    userName: string;
    telegramUsername: string | null;
    score: number;
  }[];
}

export const digestService = {
  async generateWeeklyDigest(): Promise<WeeklyDigest> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const groupId = env.TELEGRAM_GROUP_ID;

    const groupFilter = groupId
      ? eq(telegramMessages.chatId, groupId)
      : undefined;

    // Total messages (excl. bots)
    const [messageStats] = await db
      .select({
        totalMessages: count(),
        uniqueActiveMembers: sql<number>`count(distinct ${telegramMessages.fromUserId})`.mapWith(Number),
      })
      .from(telegramMessages)
      .where(
        and(
          gte(telegramMessages.date, weekAgo),
          eq(telegramMessages.fromIsBot, false),
          groupFilter,
        ),
      );

    // Top 5 contributors
    const topContributors = await db
      .select({
        fromUserId: telegramMessages.fromUserId,
        fromUsername: telegramMessages.fromUsername,
        fromFirstName: telegramMessages.fromFirstName,
        messageCount: count().as("message_count"),
      })
      .from(telegramMessages)
      .where(
        and(
          gte(telegramMessages.date, weekAgo),
          eq(telegramMessages.fromIsBot, false),
          isNotNull(telegramMessages.fromUserId),
          groupFilter,
        ),
      )
      .groupBy(
        telegramMessages.fromUserId,
        telegramMessages.fromUsername,
        telegramMessages.fromFirstName,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    // New members this week
    const newMembers = await db
      .select({
        name: user.name,
        telegramUsername: user.telegramUsername,
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(gte(members.joinedAt, weekAgo));

    // Upcoming events (reuse existing service)
    const upcomingEvents = await eventsService.listUpcoming(5);

    // New projects this week
    const newProjects = await db
      .select({
        name: projects.name,
        ownerName: user.name,
        ownerTelegramUsername: user.telegramUsername,
      })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.role, "owner"),
        ),
      )
      .innerJoin(user, eq(projectMembers.userId, user.id))
      .where(
        and(
          gte(projects.createdAt, weekAgo),
          isNull(projects.deletedAt),
        ),
      );

    // Top reputation gainers this week
    const reputationLeaders = await reputationService.getLeaderboardSince(
      weekAgo,
      5,
    );

    return {
      periodStart: weekAgo,
      periodEnd: now,
      totalMessages: messageStats?.totalMessages ?? 0,
      uniqueActiveMembers: messageStats?.uniqueActiveMembers ?? 0,
      topContributors: topContributors.map((r) => ({
        fromUserId: r.fromUserId!,
        fromUsername: r.fromUsername,
        fromFirstName: r.fromFirstName,
        messageCount: r.messageCount,
      })),
      newMembers,
      upcomingEvents,
      newProjects,
      reputationLeaders,
    };
  },
};
