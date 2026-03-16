import { Composer } from "grammy";
import type { BotContext } from "../types";
import {
  processReaction,
  processKeyword,
  type ReputationResult,
} from "../lib/reputation";
import { cacheMessage } from "../lib/message-cache";
import { resolveUser, resolveUserByUsername } from "../lib/auth";
import { reputationService } from "../../services/reputation.service";
import { VOTE_QUOTA } from "@community-os/shared/constants";

export const reputationHandler = new Composer<BotContext>();

// Cache every message for reaction resolution
reputationHandler.on("message", async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    cacheMessage(
      String(ctx.chat.id),
      String(ctx.message.message_id),
      ctx.from.id,
    );
  }
  await next();
});

// Handle emoji reactions
reputationHandler.on("message_reaction", async (ctx) => {
  const reaction = ctx.messageReaction;
  if (!reaction) return;

  const fromUser = reaction.user;
  if (!fromUser || fromUser.is_bot) return;

  for (const emoji of reaction.new_reaction) {
    if (emoji.type === "emoji") {
      const result = await processReaction({
        fromTelegramId: String(fromUser.id),
        messageId: String(reaction.message_id),
        chatId: String(reaction.chat.id),
        emoji: emoji.emoji,
      });
      if (result.status === "error") {
        console.error("Reaction reputation error:", result.message);
      }
    }
  }
});

// Handle keyword-based reputation (reply or @mention)
reputationHandler.on("message:text", async (ctx, next) => {
  const entities = ctx.message.entities ?? [];
  const hasReply = !!ctx.message.reply_to_message;

  // Find @mention or text_mention entities
  const mentionEntity = entities.find(
    (e) => e.type === "mention" || e.type === "text_mention",
  );

  // Determine if this message targets someone for reputation
  let toTelegramId: string | undefined;
  let toResolved:
    | { user: { id: string; name: string | null }; member: unknown }
    | undefined;

  if (hasReply && mentionEntity) {
    // Both reply and mention — check if they match
    const replyToUser = ctx.message.reply_to_message!.from;
    if (replyToUser && !replyToUser.is_bot) {
      let mentionTargetId: number | undefined;
      if (mentionEntity.type === "text_mention" && mentionEntity.user) {
        mentionTargetId = mentionEntity.user.id;
      }
      // For @username mentions we can't easily compare IDs, so just warn
      if (
        mentionTargetId !== undefined &&
        mentionTargetId !== replyToUser.id
      ) {
        await ctx.reply(
          "Reply or tag only one user at a time to change rep!",
          { reply_parameters: { message_id: ctx.message.message_id } },
        );
        await next();
        return;
      }
      toTelegramId = String(replyToUser.id);
    }
  } else if (hasReply) {
    // Reply only
    const replyToUser = ctx.message.reply_to_message!.from;
    if (replyToUser && !replyToUser.is_bot) {
      toTelegramId = String(replyToUser.id);
    }
  } else if (mentionEntity) {
    // Mention only (no reply)
    if (mentionEntity.type === "text_mention" && mentionEntity.user) {
      toTelegramId = String(mentionEntity.user.id);
    } else if (mentionEntity.type === "mention") {
      // @username — extract and resolve
      const username = ctx.message.text
        .slice(mentionEntity.offset + 1, mentionEntity.offset + mentionEntity.length)
        .toLowerCase();
      const resolved = await resolveUserByUsername(username);
      if (resolved) {
        toResolved = resolved;
        // Use a placeholder; processKeyword will use toResolved directly
        toTelegramId = "__resolved__";
      }
    }
  }

  if (toTelegramId && ctx.from) {
    const result = await processKeyword({
      fromTelegramId: String(ctx.from.id),
      toUserId: toTelegramId === "__resolved__" ? "" : toTelegramId,
      messageId: String(ctx.message.message_id),
      chatId: String(ctx.chat.id),
      text: ctx.message.text,
      toResolved: toResolved as
        | {
            user: { id: string; name: string | null };
            member: unknown;
          }
        | undefined,
    });

    await sendFeedback(ctx, result);
  }

  await next();
});

// /reputation command
reputationHandler.command("reputation", async (ctx) => {
  try {
    const args = ctx.match?.trim();

    let targetTelegramId = String(ctx.from!.id);
    let targetLabel = "Your";

    if (args) {
      const entities = ctx.message?.entities ?? [];
      const mentionEntity = entities.find(
        (e) => e.type === "mention" || e.type === "text_mention",
      );
      if (mentionEntity?.type === "text_mention" && mentionEntity.user) {
        targetTelegramId = String(mentionEntity.user.id);
        targetLabel = mentionEntity.user.first_name + "'s";
      }
    }

    const resolved = await resolveUser(targetTelegramId);
    if (!resolved) {
      await ctx.reply("User not found. They may need to register first.");
      return;
    }

    const score = await reputationService.getScore(resolved.user.id);
    const displayName = resolved.user.name ?? "User";

    if (targetLabel === "Your") {
      await ctx.reply(`Your reputation score: ${score}`);
    } else {
      await ctx.reply(`${displayName}'s reputation score: ${score}`);
    }
  } catch (error) {
    console.error("Failed to fetch reputation:", error);
    await ctx.reply("Failed to fetch reputation score. Please try again.");
  }
});

// /vote_quota command
reputationHandler.command("vote_quota", async (ctx) => {
  try {
    const resolved = await resolveUser(String(ctx.from!.id));
    if (!resolved) {
      await ctx.reply("You need to register first. Use /register to get started.");
      return;
    }

    const quota = await reputationService.getVoteQuota(resolved.user.id);

    let message = `You've used *${quota.votesGiven}/${VOTE_QUOTA}* votes in the last 24h.`;
    if (quota.votesRemaining > 0) {
      message += `\n${quota.votesRemaining} vote${quota.votesRemaining === 1 ? "" : "s"} remaining.`;
    } else if (quota.nextVoteIn) {
      message += `\nNext vote available in *${quota.nextVoteIn.hours}h ${quota.nextVoteIn.minutes}m*.`;
    }

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Failed to fetch vote quota:", error);
    await ctx.reply("Failed to fetch vote quota. Please try again.");
  }
});

async function sendFeedback(
  ctx: BotContext & { message: NonNullable<BotContext["message"]> },
  result: ReputationResult,
): Promise<void> {
  switch (result.status) {
    case "recorded": {
      const verb = result.value > 0 ? "increased" : "decreased";
      await ctx.reply(
        `*${result.fromName}* (${result.fromScore}) has ${verb} reputation of *${result.toName}* (${result.toScore})`,
        {
          parse_mode: "Markdown",
          reply_parameters: { message_id: ctx.message.message_id },
        },
      );
      break;
    }
    case "self_vote":
      await handleSelfVoteFeedback(ctx);
      break;
    case "quota_exceeded": {
      let msg = `You've used ${result.votesGiven}/${result.quota} votes in the last 24h.`;
      if (result.nextVoteIn) {
        msg += ` Next vote in ${result.nextVoteIn.hours}h ${result.nextVoteIn.minutes}m.`;
      }
      await ctx.reply(msg, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      break;
    }
    case "user_not_found":
      await ctx.reply("Can't find that user. They may need to register first.", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      break;
    case "error":
      console.error("Keyword reputation error:", result.message);
      break;
    // no_trigger, unknown_author, duplicate → silent
  }
}

async function handleSelfVoteFeedback(
  ctx: BotContext & { message: NonNullable<BotContext["message"]> },
): Promise<void> {
  const text = ctx.message.text?.toLowerCase() ?? "";
  // Determine if upvote or downvote keyword
  const isDownvote = ["boo", "eww"].some((kw) => text.includes(kw));
  const reply = isDownvote ? "Are you _ok_?" : "Good try there but nope.";
  await ctx.reply(reply, {
    parse_mode: "Markdown",
    reply_parameters: { message_id: ctx.message.message_id },
  });
}
