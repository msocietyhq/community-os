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
import { createAnthropic } from "@ai-sdk/anthropic";
import { trackedGenerateText } from "../bot/lib/tracked-generate-text";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { projects, projectMembers } from "../db/schema/projects";
import { events } from "../db/schema/events";
import { eventsService } from "./events.service";
import { reputationService } from "./reputation.service";
import { aiUsageService } from "./ai-usage.service";
import { env } from "../env";

export interface ThisWeekInHistory {
  year: number;
  summary: string;
  type: "topics" | "anniversary";
  highlightedMessage?: string;
  highlightedMessageAuthor?: string;
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
  aiUsage: {
    telegramUserId: number | null;
    telegramUsername: string | null;
    firstName: string;
    totalTokens: number;
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

    // Top AI users this week
    const aiUsage = await aiUsageService.getTopUsersByTokens(weekAgo, 3);

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
      aiUsage,
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
      messages: {
        messageId: number;
        text: string;
        fromUsername: string | null;
        fromFirstName: string | null;
      }[];
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
              fromFirstName: telegramMessages.fromFirstName,
              fromUsername: telegramMessages.fromUsername,
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
        yearData.push({
          year: y,
          messageCount,
          messages: messagesRaw
            .filter((m): m is typeof m & { text: string } => !!m.text)
            .map((m) => ({
              messageId: m.messageId,
              text: m.text,
              fromUsername: m.fromUsername,
              fromFirstName: m.fromFirstName,
            })),
          eventTitles: yearEvents.map((e) => e.title),
          projectNames: yearProjects.map((p) => p.name),
        });
      }
    }

    // Pick a year weighted by activity (more active years are more likely)
    if (yearData.length > 0) {
      const weights = yearData.map(
        (d) => d.messageCount + d.eventTitles.length + d.projectNames.length,
      );
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      let rand = Math.random() * totalWeight;
      let bestIndex = 0;
      for (let i = 0; i < weights.length; i++) {
        rand -= weights[i]!;
        if (rand <= 0) {
          bestIndex = i;
          break;
        }
      }
      const best = yearData[bestIndex]!;

      try {
        const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

        const messageSample = best.messages
          .slice(0, 30)
          .map((m) => {
            const author = m.fromUsername ? `@${m.fromUsername}` : m.fromFirstName ?? "unknown";
            return `[${m.messageId}] ${author}: ${m.text}`;
          })
          .join("\n");
        const eventList =
          best.eventTitles.length > 0
            ? `Events held: ${best.eventTitles.join(", ")}`
            : "No events that week.";
        const projectList =
          best.projectNames.length > 0
            ? `Projects launched: ${best.projectNames.join(", ")}`
            : "No new projects that week.";

        const result = await trackedGenerateText(
          {
            model: anthropic("claude-haiku-4-5-20251001"),
            prompt: `You're writing a "This week in ${best.year}" flashback for a Muslim tech community newsletter (MSOCIETY, Singapore).

Here's what happened during this week in ${best.year}:
- ${best.messageCount} chat messages were exchanged. Here are some of them:
${messageSample}
- ${eventList}
- ${projectList}

Do two things (output raw content only — no headers, labels, or markdown formatting like "Summary:" or "Quote:"):
1. Write a short, engaging 2-3 sentence flashback. Be a little witty or nostalgic. Match the tone to the content — if serious topics came up, be respectful. Don't use emojis. Start with "This week in ${best.year}," and keep it under 280 characters.
2. Pick ONE message that would make the best standalone quote — something insightful, funny, or representative of the community vibe. On the very last line, output QUOTE: followed by the message ID number. If no message is quote-worthy, output QUOTE: none`,
          },
          { caller: "digest" },
        );

        // Parse summary and quote ID from AI response
        const responseText = result.text.trim();
        const quoteMatch = responseText.match(/\nQUOTE:\s*(.+)$/i);
        const summary = quoteMatch
          ? responseText.slice(0, quoteMatch.index).trim()
          : responseText;

        let highlightedMessage: string | undefined;
        let highlightedMessageAuthor: string | undefined;

        if (quoteMatch) {
          const quoteValue = quoteMatch[1]!.trim();
          if (quoteValue !== "none") {
            const quoteId = Number(quoteValue);
            const quoted = best.messages.find((m) => m.messageId === quoteId);
            if (quoted) {
              highlightedMessage = quoted.text;
              highlightedMessageAuthor = quoted.fromUsername
                ? `@${quoted.fromUsername}`
                : quoted.fromFirstName ?? undefined;
            }
          }
        }

        return {
          year: best.year,
          summary,
          type: "topics",
          highlightedMessage,
          highlightedMessageAuthor,
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
