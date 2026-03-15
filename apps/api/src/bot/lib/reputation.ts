import { resolveUser } from "./auth";
import { getMessageAuthor } from "./message-cache";
import { reputationService } from "../../services/reputation.service";
import { VOTE_QUOTA } from "@community-os/shared/constants";

const REPUTATION_KEYWORDS = [
  "thanks",
  "thank you",
  "jazakallah",
  "boo",
  "eww",
];

export type ReputationResult =
  | {
      status: "recorded";
      fromName: string;
      toName: string;
      fromScore: number;
      toScore: number;
      value: number;
    }
  | { status: "self_vote" }
  | {
      status: "quota_exceeded";
      votesGiven: number;
      quota: number;
      nextVoteIn: { hours: number; minutes: number } | null;
    }
  | { status: "no_trigger" }
  | { status: "user_not_found" }
  | { status: "unknown_author" }
  | { status: "duplicate" };

interface ReactionEvent {
  fromTelegramId: string;
  messageId: string;
  chatId: string;
  emoji: string;
}

interface KeywordEvent {
  fromTelegramId: string;
  toUserId: string;
  messageId: string;
  chatId: string;
  text: string;
  /** Pre-resolved recipient (skips resolveUser for toUserId) */
  toResolved?: { user: { id: string; name: string | null }; member: unknown };
}

export async function processReaction(
  event: ReactionEvent,
): Promise<ReputationResult> {
  try {
    const toTelegramUserId = getMessageAuthor(event.chatId, event.messageId);
    if (!toTelegramUserId) return { status: "unknown_author" };

    if (String(toTelegramUserId) === event.fromTelegramId) {
      return { status: "self_vote" };
    }

    const trigger = await reputationService.findTrigger(
      "reaction",
      event.emoji,
    );
    if (!trigger) return { status: "no_trigger" };

    const [fromUser, toUser] = await Promise.all([
      resolveUser(event.fromTelegramId),
      resolveUser(String(toTelegramUserId)),
    ]);
    if (!fromUser || !toUser) return { status: "user_not_found" };

    // Check vote quota
    const quota = await reputationService.getVoteQuota(fromUser.user.id);
    if (quota.votesRemaining <= 0) {
      return {
        status: "quota_exceeded",
        votesGiven: quota.votesGiven,
        quota: VOTE_QUOTA,
        nextVoteIn: quota.nextVoteIn,
      };
    }

    const recorded = await reputationService.recordEvent({
      fromUserId: fromUser.user.id,
      toUserId: toUser.user.id,
      triggerId: trigger.id,
      value: trigger.reputationValue,
      telegramMessageId: event.messageId,
      telegramChatId: event.chatId,
    });
    if (!recorded) return { status: "duplicate" };

    const [fromScore, toScore] = await Promise.all([
      reputationService.getScore(fromUser.user.id),
      reputationService.getScore(toUser.user.id),
    ]);

    return {
      status: "recorded",
      fromName: fromUser.user.name ?? "User",
      toName: toUser.user.name ?? "User",
      fromScore,
      toScore,
      value: trigger.reputationValue,
    };
  } catch (error) {
    console.error("Failed to process reputation reaction:", error);
    return { status: "no_trigger" };
  }
}

export async function processKeyword(
  event: KeywordEvent,
): Promise<ReputationResult> {
  const lowerText = event.text.toLowerCase();

  const matchedKeyword = REPUTATION_KEYWORDS.find((kw) =>
    lowerText.includes(kw),
  );
  if (!matchedKeyword) return { status: "no_trigger" };

  try {
    const trigger = await reputationService.findTrigger(
      "keyword",
      matchedKeyword,
    );
    if (!trigger) return { status: "no_trigger" };

    const fromUser = await resolveUser(event.fromTelegramId);
    if (!fromUser) return { status: "user_not_found" };

    const toUser =
      event.toResolved ??
      (await resolveUser(event.toUserId));
    if (!toUser) return { status: "user_not_found" };

    // Prevent self-reputation
    if (fromUser.user.id === toUser.user.id) return { status: "self_vote" };

    // Check vote quota
    const quota = await reputationService.getVoteQuota(fromUser.user.id);
    if (quota.votesRemaining <= 0) {
      return {
        status: "quota_exceeded",
        votesGiven: quota.votesGiven,
        quota: VOTE_QUOTA,
        nextVoteIn: quota.nextVoteIn,
      };
    }

    const recorded = await reputationService.recordEvent({
      fromUserId: fromUser.user.id,
      toUserId: toUser.user.id,
      triggerId: trigger.id,
      value: trigger.reputationValue,
      telegramMessageId: event.messageId,
      telegramChatId: event.chatId,
    });
    if (!recorded) return { status: "duplicate" };

    const [fromScore, toScore] = await Promise.all([
      reputationService.getScore(fromUser.user.id),
      reputationService.getScore(toUser.user.id),
    ]);

    return {
      status: "recorded",
      fromName: fromUser.user.name ?? "User",
      toName: toUser.user.name ?? "User",
      fromScore,
      toScore,
      value: trigger.reputationValue,
    };
  } catch (error) {
    console.error("Failed to process reputation keyword:", error);
    return { status: "no_trigger" };
  }
}
