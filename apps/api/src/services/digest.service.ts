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
import { z } from "zod";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { projects, projectMembers } from "../db/schema/projects";
import { events } from "../db/schema/events";
import { eventsService } from "./events.service";
import { reputationService } from "./reputation.service";
import { aiService } from "./ai.service";
import { membersService } from "./members.service";
import { env } from "../env";

/**
 * Singapore is a fixed UTC+8 with no DST, so a constant offset converts a
 * Singapore calendar boundary to the UTC instant our timestamps are stored in.
 */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface Period {
  /** First instant of the period, inclusive. */
  start: Date;
  /** Last instant of the period, inclusive. */
  end: Date;
}

/** UTC instant of 00:00 SGT on the 1st of the month `delta` months from `at`. */
function sgtMonthStart(at: Date, delta: number): Date {
  const sgt = new Date(at.getTime() + SGT_OFFSET_MS);
  return new Date(
    Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth() + delta, 1) - SGT_OFFSET_MS,
  );
}

/** The calendar month that most recently ended — 1–31 Jul when run in August. */
export function previousCalendarMonth(at = new Date()): Period {
  return {
    start: sgtMonthStart(at, -1),
    end: new Date(sgtMonthStart(at, 0).getTime() - 1),
  };
}

/** The current calendar month so far — its 1st through `at`. */
function monthToDate(at = new Date()): Period {
  return { start: sgtMonthStart(at, 0), end: at };
}

/** All of `year`'s copy of the Singapore calendar month containing `at`. */
function sameMonthInYear(at: Date, year: number): Period {
  const sgt = new Date(at.getTime() + SGT_OFFSET_MS);
  const month = sgt.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - SGT_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - SGT_OFFSET_MS - 1),
  };
}

export interface ThisMonthInHistory {
  year: number;
  summary: string;
  type: "topics" | "anniversary";
  highlightedMessage?: string;
  highlightedMessageAuthor?: string;
}

export interface MonthlyDigest {
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

const MONTH_NAME = new Intl.DateTimeFormat("en-SG", {
  month: "long",
  timeZone: "Asia/Singapore",
});

/**
 * The model judges before it writes. Keeping the verdict in the same call as
 * the prose means it can't talk itself into a flashback it already decided
 * wasn't worth one.
 */
const historyVerdictSchema = z.object({
  worthPosting: z
    .boolean()
    .describe("True only if this month genuinely deserves a flashback post"),
  summary: z
    .string()
    .describe("The flashback itself, or an empty string when not posting"),
  quoteMessageId: z
    .number()
    .nullable()
    .describe("ID of the message to quote, or null if none stands alone"),
});

export const digestService = {
  /**
   * Defaults to the month so far, which is what an on-demand `/digest` should
   * show. The scheduled run passes the previous calendar month instead, so the
   * 1st-of-the-month post is a clean "July in review".
   */
  async generateMonthlyDigest(period: Period = monthToDate()): Promise<MonthlyDigest> {
    const { start, end } = period;
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
          gte(telegramMessages.date, start),
          lte(telegramMessages.date, end),
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
          gte(telegramMessages.date, start),
          lte(telegramMessages.date, end),
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

    // New members this month.
    //
    // "New member" means someone who joined the Telegram group, so a member row
    // alone doesn't qualify — the row is also created for portal sign-ups and
    // for anyone the bot has transacted with. Each candidate is confirmed
    // against the group itself; a row is not evidence of presence there.
    // Candidates per month are single digits, so the calls are cheap.
    const newMemberCandidates = await db
      .select({
        name: user.name,
        telegramUsername: user.telegramUsername,
        telegramId: user.telegramId,
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(
        and(
          gte(members.joinedAt, start),
          lte(members.joinedAt, end),
          isNotNull(user.telegramId),
        ),
      );

    const membershipChecks = await Promise.all(
      newMemberCandidates.map((m) => membersService.isInGroup(m.telegramId!)),
    );
    const newMembers = newMemberCandidates
      .filter((_, i) => membershipChecks[i])
      .map(({ name, telegramUsername }) => ({ name, telegramUsername }));

    // Upcoming events (reuse existing service)
    const upcomingEvents = await eventsService.listUpcoming(5);

    // New projects this month
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
          gte(projects.createdAt, start),
          lte(projects.createdAt, end),
          isNull(projects.deletedAt),
        ),
      );

    // Top reputation gainers this month
    const reputationLeaders = await reputationService.getLeaderboardSince(
      start,
      5,
      end,
    );

    // Top AI users this month
    const aiUsage = await aiService.getTopUsersByTokens(start, 3, end);

    return {
      periodStart: start,
      periodEnd: end,
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

  /**
   * A flashback to this calendar month in a past year, or `null` when nothing
   * from back then clears the bar.
   *
   * Returning `null` is the common case by design: this posts once a month, and
   * a mediocre "people chatted about deployment" recap is worse than silence.
   * The model is asked to judge before it writes, and told that declining is
   * the expected answer.
   */
  async getThisMonthInHistory(): Promise<ThisMonthInHistory | null> {
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
      const { start: rangeStart, end: rangeEnd } = sameMonthInYear(now, y);

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
            .limit(60),
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
        const messageSample = best.messages
          .slice(0, 40)
          .map((m) => {
            const author = m.fromUsername ? `@${m.fromUsername}` : m.fromFirstName ?? "unknown";
            return `[${m.messageId}] ${author}: ${m.text}`;
          })
          .join("\n");
        const eventList =
          best.eventTitles.length > 0
            ? `Events held: ${best.eventTitles.join(", ")}`
            : "No events that month.";
        const projectList =
          best.projectNames.length > 0
            ? `Projects launched: ${best.projectNames.join(", ")}`
            : "No new projects that month.";

        const monthName = MONTH_NAME.format(now);

        const result = await aiService.generateObject(
          {
            model: aiService.models.smart,
            schema: historyVerdictSchema,
            prompt: `You're deciding whether a "This month in ${best.year}" flashback is worth posting to a Muslim tech community's Telegram group (MSOCIETY, Singapore), and writing it if so.

Here's what happened during ${monthName} ${best.year}:
- ${best.messageCount} chat messages were exchanged. Here are some of them:
${messageSample}
- ${eventList}
- ${projectList}

First judge: is any of this TRULY interesting to look back on? Set worthPosting true only if there is a specific, concrete hook — a memorable exchange, a launch, a decision that still shapes things today, a genuinely funny or moving moment, a milestone. Set it false for routine chatter, logistics, scheduling, greetings, or anything where the flashback would amount to "people talked about stuff". Declining is the expected answer most months; a forgettable post is worse than no post, and you are not being asked to find something.

If worthPosting is false, leave summary empty and quoteMessageId null.

If worthPosting is true:
- summary: a 2-3 sentence flashback starting with "This month in ${best.year},". Witty or nostalgic, respectful if the topics were serious. No emojis, no markdown, under 280 characters. Do NOT include or paraphrase the quoted message — the quote is displayed separately.
- quoteMessageId: the ID of the ONE message that stands alone best — insightful, funny, or true to the community's character. Null if none is quote-worthy.`,
          },
          { caller: "digest" },
        );

        // Widened to `unknown` by the tracking wrapper; re-parse to recover the type.
        const verdict = historyVerdictSchema.parse(result.object);

        if (!verdict.worthPosting || !verdict.summary.trim()) {
          console.log(
            `History digest: ${best.year} judged not interesting enough to post`,
          );
          return null;
        }

        const quoted =
          verdict.quoteMessageId === null
            ? undefined
            : best.messages.find((m) => m.messageId === verdict.quoteMessageId);

        return {
          year: best.year,
          summary: verdict.summary.trim(),
          type: "topics",
          highlightedMessage: quoted?.text,
          highlightedMessageAuthor: quoted
            ? quoted.fromUsername
              ? `@${quoted.fromUsername}`
              : quoted.fromFirstName ?? undefined
            : undefined,
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
        return `This month marks ${name}'s ${suffix} year in the community!`;
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
