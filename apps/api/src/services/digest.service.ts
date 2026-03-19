import {
  eq,
  and,
  gte,
  lte,
  isNull,
  isNotNull,
  count,
  desc,
  sql,
} from "drizzle-orm";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { projects, projectMembers } from "../db/schema/projects";
import { events } from "../db/schema/events";
import { eventsService } from "./events.service";
import { reputationService } from "./reputation.service";
import { env } from "../env";

export interface ThisWeekInHistory {
  year: number;
  summary: string;
  type: "topics" | "anniversary";
  replyToMessageId?: number;
  replyToChatId?: string;
}

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

  async getThisWeekInHistory(): Promise<ThisWeekInHistory | null> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const groupId = env.TELEGRAM_GROUP_ID;

    // Collect activity per past year
    const yearData: {
      year: number;
      messageCount: number;
      messages: string[];
      bestMessageId: number | null;
      eventTitles: string[];
      projectNames: string[];
    }[] = [];

    for (let y = currentYear - 1; y >= currentYear - 10; y--) {
      const rangeStart = new Date(now);
      rangeStart.setFullYear(y);
      rangeStart.setDate(rangeStart.getDate() - 3);
      rangeStart.setHours(0, 0, 0, 0);

      const rangeEnd = new Date(now);
      rangeEnd.setFullYear(y);
      rangeEnd.setDate(rangeEnd.getDate() + 3);
      rangeEnd.setHours(23, 59, 59, 999);

      const groupFilter = groupId
        ? eq(telegramMessages.chatId, groupId)
        : undefined;

      const [msgResult, messagesRaw, yearEvents, yearProjects] =
        await Promise.all([
          db
            .select({ total: count() })
            .from(telegramMessages)
            .where(
              and(
                gte(telegramMessages.date, rangeStart),
                lte(telegramMessages.date, rangeEnd),
                eq(telegramMessages.fromIsBot, false),
                isNotNull(telegramMessages.text),
                groupFilter,
              ),
            ),
          db
            .select({
              text: telegramMessages.text,
              messageId: telegramMessages.messageId,
              replyToMessageId: telegramMessages.replyToMessageId,
            })
            .from(telegramMessages)
            .where(
              and(
                gte(telegramMessages.date, rangeStart),
                lte(telegramMessages.date, rangeEnd),
                eq(telegramMessages.fromIsBot, false),
                isNotNull(telegramMessages.text),
                groupFilter,
              ),
            )
            .orderBy(desc(telegramMessages.replyToMessageId))
            .limit(50),
          db
            .select({ title: events.title })
            .from(events)
            .where(
              and(
                gte(events.startsAt, rangeStart),
                lte(events.startsAt, rangeEnd),
                sql`${events.status} != 'cancelled'`,
                isNull(events.deletedAt),
              ),
            ),
          db
            .select({ name: projects.name })
            .from(projects)
            .where(
              and(
                gte(projects.createdAt, rangeStart),
                lte(projects.createdAt, rangeEnd),
                isNull(projects.deletedAt),
              ),
            ),
        ]);

      const messageCount = msgResult[0]?.total ?? 0;
      const totalActivity =
        messageCount + yearEvents.length + yearProjects.length;

      if (totalActivity > 0) {
        // Find the most-replied-to message to use as reply target
        const replyCounts = new Map<number, number>();
        for (const m of messagesRaw) {
          if (m.replyToMessageId) {
            replyCounts.set(
              m.replyToMessageId,
              (replyCounts.get(m.replyToMessageId) ?? 0) + 1,
            );
          }
        }
        let bestMessageId: number | null = null;
        if (replyCounts.size > 0) {
          bestMessageId = [...replyCounts.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0]![0];
        } else if (messagesRaw.length > 0) {
          // Fall back to the first message in the sample
          bestMessageId = messagesRaw[0]!.messageId;
        }

        yearData.push({
          year: y,
          messageCount,
          messages: messagesRaw
            .map((m) => m.text)
            .filter((t): t is string => !!t),
          bestMessageId,
          eventTitles: yearEvents.map((e) => e.title),
          projectNames: yearProjects.map((p) => p.name),
        });
      }
    }

    // Pick the most active year
    if (yearData.length > 0) {
      yearData.sort(
        (a, b) =>
          b.messageCount +
          b.eventTitles.length +
          b.projectNames.length -
          (a.messageCount + a.eventTitles.length + a.projectNames.length),
      );
      // Safe: yearData.length > 0 checked above
      const best = yearData[0]!;

      try {
        const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

        const messageSample = best.messages.slice(0, 30).join("\n- ");
        const eventList =
          best.eventTitles.length > 0
            ? `Events held: ${best.eventTitles.join(", ")}`
            : "No events that week.";
        const projectList =
          best.projectNames.length > 0
            ? `Projects launched: ${best.projectNames.join(", ")}`
            : "No new projects that week.";

        const result = await generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          prompt: `You're writing a "This week in ${best.year}" flashback for a Muslim tech community newsletter (MSOCIETY, Singapore).

Here's what happened during this week in ${best.year}:
- ${best.messageCount} chat messages were exchanged. Here are some of them:
- ${messageSample}
- ${eventList}
- ${projectList}

Write a short, engaging 2-3 sentence summary. Be a little witty or nostalgic. Match the tone to the content — if serious topics came up, be respectful. Don't use emojis. Start with "This week in ${best.year}," and keep it under 280 characters.`,
        });

        return {
          year: best.year,
          summary: result.text.trim(),
          type: "topics",
          replyToMessageId: best.bestMessageId ?? undefined,
          replyToChatId: groupId ?? undefined,
        };
      } catch (err) {
        console.error("AI generation failed for history digest:", err);
        // Fall through to anniversary fallback
      }
    }

    // Fallback: member anniversaries
    const anniversaryMembers = await db
      .select({
        name: user.name,
        telegramUsername: user.telegramUsername,
        joinedAt: members.joinedAt,
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(
        and(
          isNotNull(members.joinedAt),
          sql`extract(month from ${members.joinedAt}) = extract(month from now())`,
          sql`extract(day from ${members.joinedAt}) between extract(day from now()) - 3 and extract(day from now()) + 3`,
          sql`extract(year from ${members.joinedAt}) < extract(year from now())`,
        ),
      )
      .orderBy(members.joinedAt)
      .limit(3);

    if (anniversaryMembers.length > 0) {
      const lines = anniversaryMembers.map((m) => {
        const years = currentYear - (m.joinedAt?.getFullYear() ?? currentYear);
        const name = m.telegramUsername
          ? `@${m.telegramUsername}`
          : m.name || "A member";
        const suffix =
          years === 1
            ? "1st"
            : years === 2
              ? "2nd"
              : years === 3
                ? "3rd"
                : `${years}th`;
        return `This week marks ${name}'s ${suffix} year in the community!`;
      });

      return {
        year:
          anniversaryMembers[0]!.joinedAt?.getFullYear() ?? currentYear - 1,
        summary: lines.join("\n"),
        type: "anniversary",
      };
    }

    return null;
  },
};
