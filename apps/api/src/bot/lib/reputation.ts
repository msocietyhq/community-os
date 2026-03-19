import { resolveUser } from "./auth";
import { reputationService } from "../../services/reputation.service";
import { VOTE_QUOTA } from "@community-os/shared/constants";

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
  | { status: "error"; message: string };

interface KeywordEvent {
  fromTelegramId: string;
  toUserId: string;
  messageId: string;
  chatId: string;
  text: string;
  /** Pre-resolved recipient (skips resolveUser for toUserId) */
  toResolved?: { user: { id: string; name: string | null }; member: unknown };
}

export async function processKeyword(
  event: KeywordEvent,
): Promise<ReputationResult> {
  const lowerText = event.text.toLowerCase();

  const keywords = await reputationService.getKeywordValues();
  const matchedKeyword = keywords.find((kw) =>
    lowerText.includes(kw),
  );
  if (!matchedKeyword) return { status: "no_trigger" };

  try {
    const trigger = await reputationService.findTrigger(matchedKeyword);
    if (!trigger) return { status: "no_trigger" };

    const fromUser = await resolveUser(event.fromTelegramId);
    if (!fromUser) return { status: "user_not_found" };

    const toUser =
      event.toResolved ??
      (await resolveUser(event.toUserId));
    if (!toUser) return { status: "user_not_found" };

    // Prevent self-reputation
    if (fromUser.user.id === toUser.user.id) return { status: "self_vote" };

    // Check vote quota (exclude current message — already inserted by logger middleware)
    const quota = await reputationService.getVoteQuota(fromUser.user.id, {
      chatId: event.chatId,
      messageId: event.messageId,
    });
    if (quota.votesRemaining <= 0) {
      return {
        status: "quota_exceeded",
        votesGiven: quota.votesGiven,
        quota: VOTE_QUOTA,
        nextVoteIn: quota.nextVoteIn,
      };
    }

    // Recompute score from telegram_messages (idempotent)
    await reputationService.recalculateScore(toUser.user.id);

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
    return { status: "error", message: String(error) };
  }
}
