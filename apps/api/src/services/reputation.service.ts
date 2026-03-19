import { eq, desc, and, gte, asc, isNotNull, not, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { reputationTriggers } from "../db/schema/reputation";
import { telegramMessages } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import { members } from "../db/schema/members";
import {
  VOTE_QUOTA,
  VOTE_QUOTA_DURATION_HOURS,
} from "@community-os/shared/constants";

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

/** Resolve a user's telegramId (text) from the user table. */
async function getTelegramId(userId: string): Promise<string | null> {
  const row = await db
    .select({ telegramId: user.telegramId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row[0]?.telegramId ?? null;
}

/**
 * Score a set of reply message texts against keyword triggers.
 * Returns the sum of first-match trigger values.
 */
/**
 * Score messages with per-voter daily quota enforcement.
 * Each voter can contribute at most VOTE_QUOTA keyword messages per 24h window
 * toward a recipient's score. Messages must have fromUserId and date for quota
 * enforcement; messages missing either field are skipped.
 */
function scoreMessages(
  messages: {
    text: string | null;
    fromUserId: number | null;
    date: Date | null;
  }[],
  keywordTriggers: TriggerRow[],
): number {
  // Sort by date ascending so we process earliest votes first
  const sorted = [...messages].sort(
    (a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0),
  );

  // Track per-voter vote timestamps to enforce rolling 24h quota
  const voterVoteTimes = new Map<number, Date[]>();
  let total = 0;

  for (const row of sorted) {
    if (!row.fromUserId || !row.date) continue;

    const text = (row.text ?? "").toLowerCase();
    const matchedTrigger = keywordTriggers.find((t) =>
      text.includes(t.triggerValue),
    );
    if (!matchedTrigger) continue;

    // Count how many votes this voter cast in the 24h window before this message
    const cutoff = new Date(row.date.getTime() - VOTE_QUOTA_DURATION_HOURS * 60 * 60 * 1000);
    const priorVotes = voterVoteTimes.get(row.fromUserId) ?? [];
    const votesInWindow = priorVotes.filter((d) => d >= cutoff).length;

    if (votesInWindow >= VOTE_QUOTA) continue; // quota exceeded, skip

    total += matchedTrigger.reputationValue;
    voterVoteTimes.set(row.fromUserId, [...priorVotes, row.date]);
  }

  return total;
}

export const reputationService = {
  /** Returns all active keyword trigger values from cache. */
  async getKeywordValues(): Promise<string[]> {
    const triggers = await loadTriggers();
    return triggers
      .filter((t) => t.triggerType === "keyword")
      .map((t) => t.triggerValue);
  },

  async findTrigger(value: string) {
    const triggers = await loadTriggers();
    return triggers.find((t) => t.triggerValue === value) ?? null;
  },

  /** Read materialized score from members table. */
  async getScore(userId: string): Promise<number> {
    const result = await db
      .select({ score: members.reputationScore })
      .from(members)
      .where(eq(members.userId, userId))
      .limit(1);
    return result[0]?.score ?? 0;
  },

  /** Recompute reputation for one user from telegram_messages and persist. */
  async recalculateScore(userId: string): Promise<void> {
    const telegramId = await getTelegramId(userId);
    if (!telegramId) return;

    const triggers = await loadTriggers();
    const keywordTriggers = triggers.filter((t) => t.triggerType === "keyword");
    if (keywordTriggers.length === 0) return;

    // Self-join: find reply messages where the original was authored by this user
    const origMsg = alias(telegramMessages, "orig");
    const replyMessages = await db
      .select({
        text: telegramMessages.text,
        fromUserId: telegramMessages.fromUserId,
        date: telegramMessages.date,
      })
      .from(telegramMessages)
      .innerJoin(
        origMsg,
        and(
          eq(telegramMessages.chatId, origMsg.chatId),
          eq(telegramMessages.replyToMessageId, origMsg.messageId),
        ),
      )
      .where(
        and(
          eq(origMsg.fromUserId, Number(telegramId)),
          isNotNull(telegramMessages.text),
        ),
      );

    const totalScore = scoreMessages(replyMessages, keywordTriggers);

    await db
      .update(members)
      .set({ reputationScore: totalScore })
      .where(eq(members.userId, userId));
  },

  /** Bulk recompute reputation for all users. */
  async recalculateAllScores(): Promise<void> {
    const allUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(isNotNull(user.telegramId));

    for (const u of allUsers) {
      await this.recalculateScore(u.id);
    }
  },

  /** Recent keyword-triggered messages received by a user. */
  async getEvents(userId: string, limit = 20) {
    const telegramId = await getTelegramId(userId);
    if (!telegramId) return [];

    const triggers = await loadTriggers();
    const keywordTriggers = triggers.filter((t) => t.triggerType === "keyword");

    const origMsg = alias(telegramMessages, "orig");
    // Fetch extra rows to account for non-keyword replies
    const candidates = await db
      .select({
        chatId: telegramMessages.chatId,
        messageId: telegramMessages.messageId,
        fromUserId: telegramMessages.fromUserId,
        text: telegramMessages.text,
        date: telegramMessages.date,
      })
      .from(telegramMessages)
      .innerJoin(
        origMsg,
        and(
          eq(telegramMessages.chatId, origMsg.chatId),
          eq(telegramMessages.replyToMessageId, origMsg.messageId),
        ),
      )
      .where(
        and(
          eq(origMsg.fromUserId, Number(telegramId)),
          isNotNull(telegramMessages.text),
        ),
      )
      .orderBy(desc(telegramMessages.date))
      .limit(limit * 3);

    const result: {
      chatId: string;
      messageId: number;
      fromUserId: number | null;
      value: number;
      date: Date | null;
      trigger: {
        id: string;
        triggerType: string;
        triggerValue: string;
      };
    }[] = [];

    for (const row of candidates) {
      const text = (row.text ?? "").toLowerCase();
      const trigger = keywordTriggers.find((t) => text.includes(t.triggerValue));
      if (!trigger) continue;
      result.push({
        chatId: row.chatId,
        messageId: row.messageId,
        fromUserId: row.fromUserId,
        value: trigger.reputationValue,
        date: row.date,
        trigger: {
          id: trigger.id,
          triggerType: trigger.triggerType,
          triggerValue: trigger.triggerValue,
        },
      });
      if (result.length >= limit) break;
    }

    return result;
  },

  /** Count keyword-matching reply messages from a user in the quota window.
   *  Pass excludeMessage to omit the current message (already inserted by the
   *  logger middleware before the reputation handler runs). */
  async getVoteQuota(
    fromUserId: string,
    excludeMessage?: { chatId: string; messageId: string },
  ) {
    const hours = VOTE_QUOTA_DURATION_HOURS;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const telegramId = await getTelegramId(fromUserId);
    let votesGiven = 0;
    let nextVoteIn: { hours: number; minutes: number } | null = null;

    if (telegramId) {
      const triggers = await loadTriggers();
      const keywordValues = triggers
        .filter((t) => t.triggerType === "keyword")
        .map((t) => t.triggerValue);

      const recentReplies = await db
        .select({
          text: telegramMessages.text,
          date: telegramMessages.date,
        })
        .from(telegramMessages)
        .where(
          and(
            eq(telegramMessages.fromUserId, Number(telegramId)),
            gte(telegramMessages.date, cutoff),
            isNotNull(telegramMessages.replyToMessageId),
            isNotNull(telegramMessages.text),
            excludeMessage
              ? not(
                  and(
                    eq(telegramMessages.chatId, excludeMessage.chatId),
                    eq(
                      telegramMessages.messageId,
                      Number(excludeMessage.messageId),
                    ),
                  )!,
                )
              : undefined,
          ),
        )
        .orderBy(asc(telegramMessages.date));

      const matchingVotes = recentReplies.filter((r) => {
        const text = (r.text ?? "").toLowerCase();
        return keywordValues.some((kw) => text.includes(kw));
      });

      votesGiven = matchingVotes.length;

      if (votesGiven >= VOTE_QUOTA && matchingVotes[0]?.date) {
        const expiresAt =
          matchingVotes[0].date.getTime() + hours * 60 * 60 * 1000;
        const msRemaining = Math.max(0, expiresAt - Date.now());
        const totalMinutes = Math.ceil(msRemaining / (60 * 1000));
        nextVoteIn = {
          hours: Math.floor(totalMinutes / 60),
          minutes: totalMinutes % 60,
        };
      }
    }

    const votesRemaining = Math.max(0, VOTE_QUOTA - votesGiven);
    return { votesGiven, votesRemaining, nextVoteIn };
  },

  /** Leaderboard from materialized members.reputation_score. */
  async getLeaderboard(limit = 10) {
    const rows = await db
      .select({
        userId: members.userId,
        score: members.reputationScore,
        userName: user.name,
        telegramUsername: user.telegramUsername,
      })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .orderBy(desc(members.reputationScore))
      .limit(limit);
    return rows;
  },

  /** Leaderboard of reputation gained since a given date. */
  async getLeaderboardSince(since: Date, limit = 5) {
    const triggers = await loadTriggers();
    const keywordTriggers = triggers.filter((t) => t.triggerType === "keyword");
    if (keywordTriggers.length === 0) return [];

    const origMsg = alias(telegramMessages, "orig");
    const replyRows = await db
      .select({
        recipientTelegramId: origMsg.fromUserId,
        text: telegramMessages.text,
        fromUserId: telegramMessages.fromUserId,
        date: telegramMessages.date,
      })
      .from(telegramMessages)
      .innerJoin(
        origMsg,
        and(
          eq(telegramMessages.chatId, origMsg.chatId),
          eq(telegramMessages.replyToMessageId, origMsg.messageId),
        ),
      )
      .where(
        and(
          gte(telegramMessages.date, since),
          isNotNull(telegramMessages.text),
        ),
      );

    // Group replies by recipient and score them
    const byRecipient = new Map<number, typeof replyRows>();
    for (const row of replyRows) {
      if (!row.recipientTelegramId) continue;
      const existing = byRecipient.get(row.recipientTelegramId) ?? [];
      existing.push(row);
      byRecipient.set(row.recipientTelegramId, existing);
    }

    const scored: { telegramId: number; score: number }[] = [];
    for (const [telegramId, messages] of byRecipient) {
      const score = scoreMessages(messages, keywordTriggers);
      if (score > 0) scored.push({ telegramId, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const topScored = scored.slice(0, limit);
    if (topScored.length === 0) return [];

    // Resolve user info
    const userRows = await db
      .select({
        telegramId: user.telegramId,
        userName: user.name,
        telegramUsername: user.telegramUsername,
        userId: user.id,
      })
      .from(user)
      .where(
        or(
          ...topScored.map((s) => eq(user.telegramId, String(s.telegramId))),
        ),
      );

    const userMap = new Map(userRows.map((u) => [u.telegramId, u]));

    return topScored
      .map((s) => {
        const u = userMap.get(String(s.telegramId));
        return {
          userId: u?.userId ?? "",
          userName: u?.userName ?? "Unknown",
          telegramUsername: u?.telegramUsername ?? null,
          score: s.score,
        };
      })
      .filter((r) => r.userId);
  },
};
