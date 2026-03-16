import { eq, sum, desc, sql, and, gte, count, asc } from "drizzle-orm";
import { db } from "../db";
import {
  reputationEvents,
  reputationTriggers,
} from "../db/schema/reputation";
import { user } from "../db/schema/auth";
import { members } from "../db/schema/members";
import {
  VOTE_QUOTA,
  VOTE_QUOTA_DURATION_HOURS,
} from "@community-os/shared/constants";

interface RecordEventInput {
  fromUserId: string;
  toUserId: string;
  triggerId: string;
  value: number;
  telegramMessageId?: string;
  telegramChatId?: string;
}

type TriggerRow = typeof reputationTriggers.$inferSelect;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let triggerCache: TriggerRow[] = [];
let cacheLoadedAt = 0;

async function loadTriggers(): Promise<TriggerRow[]> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS && triggerCache.length > 0) {
    return triggerCache;
  }
  triggerCache = await db
    .select()
    .from(reputationTriggers)
    .where(eq(reputationTriggers.isActive, true));
  cacheLoadedAt = Date.now();
  return triggerCache;
}

export const reputationService = {
  /** Returns all active keyword trigger values from cache. */
  async getKeywordValues(): Promise<string[]> {
    const triggers = await loadTriggers();
    return triggers
      .filter((t) => t.triggerType === "keyword")
      .map((t) => t.triggerValue);
  },

  async findTrigger(type: "reaction" | "keyword", value: string) {
    const triggers = await loadTriggers();
    return triggers.find(
      (t) => t.triggerType === type && t.triggerValue === value,
    ) ?? null;
  },

  async recordEvent(input: RecordEventInput) {
    try {
      const [event] = await db
        .insert(reputationEvents)
        .values({
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          triggerId: input.triggerId,
          value: input.value,
          telegramMessageId: input.telegramMessageId,
          telegramChatId: input.telegramChatId,
        })
        .onConflictDoNothing()
        .returning();
      return event ?? null;
    } catch (error) {
      console.error("Failed to record reputation event:", error);
      return null;
    }
  },

  async getScore(userId: string): Promise<number> {
    const result = await db
      .select({ score: sum(reputationEvents.value) })
      .from(reputationEvents)
      .where(eq(reputationEvents.toUserId, userId));
    return Number(result[0]?.score ?? 0);
  },

  async getEvents(userId: string, limit = 20) {
    const events = await db
      .select({
        id: reputationEvents.id,
        fromUserId: reputationEvents.fromUserId,
        toUserId: reputationEvents.toUserId,
        value: reputationEvents.value,
        telegramMessageId: reputationEvents.telegramMessageId,
        telegramChatId: reputationEvents.telegramChatId,
        createdAt: reputationEvents.createdAt,
        trigger: {
          id: reputationTriggers.id,
          triggerType: reputationTriggers.triggerType,
          triggerValue: reputationTriggers.triggerValue,
        },
      })
      .from(reputationEvents)
      .leftJoin(
        reputationTriggers,
        eq(reputationEvents.triggerId, reputationTriggers.id),
      )
      .where(eq(reputationEvents.toUserId, userId))
      .orderBy(desc(reputationEvents.createdAt))
      .limit(limit);
    return events;
  },

  async getRecentVoteCount(
    fromUserId: string,
    hours: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: count() })
      .from(reputationEvents)
      .where(
        and(
          eq(reputationEvents.fromUserId, fromUserId),
          gte(reputationEvents.createdAt, cutoff),
        ),
      );
    return result[0]?.count ?? 0;
  },

  async getVoteQuota(fromUserId: string) {
    const hours = VOTE_QUOTA_DURATION_HOURS;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const votesGiven = await this.getRecentVoteCount(fromUserId, hours);
    const votesRemaining = Math.max(0, VOTE_QUOTA - votesGiven);

    let nextVoteIn: { hours: number; minutes: number } | null = null;

    if (votesRemaining === 0) {
      // Find the oldest vote in the window — when it expires, a slot opens
      const oldest = await db
        .select({ createdAt: reputationEvents.createdAt })
        .from(reputationEvents)
        .where(
          and(
            eq(reputationEvents.fromUserId, fromUserId),
            gte(reputationEvents.createdAt, cutoff),
          ),
        )
        .orderBy(asc(reputationEvents.createdAt))
        .limit(1);

      if (oldest[0]?.createdAt) {
        const expiresAt =
          oldest[0].createdAt.getTime() + hours * 60 * 60 * 1000;
        const msRemaining = Math.max(0, expiresAt - Date.now());
        const totalMinutes = Math.ceil(msRemaining / (60 * 1000));
        nextVoteIn = {
          hours: Math.floor(totalMinutes / 60),
          minutes: totalMinutes % 60,
        };
      }
    }

    return { votesGiven, votesRemaining, nextVoteIn };
  },

  async getLeaderboard(limit = 10) {
    const rows = await db
      .select({
        userId: reputationEvents.toUserId,
        score: sum(reputationEvents.value).mapWith(Number),
        userName: user.name,
        telegramUsername: user.telegramUsername,
      })
      .from(reputationEvents)
      .innerJoin(user, eq(reputationEvents.toUserId, user.id))
      .groupBy(
        reputationEvents.toUserId,
        user.name,
        user.telegramUsername,
      )
      .orderBy(desc(sql`sum(${reputationEvents.value})`))
      .limit(limit);
    return rows;
  },
};
