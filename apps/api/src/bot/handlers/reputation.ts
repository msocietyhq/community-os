import { Composer } from "grammy";
import type { BotContext } from "../types";
import {
  processKeyword,
  type ReputationResult,
} from "../lib/reputation";
import { resolveUser, resolveUserByUsername } from "../lib/auth";
import { reputationService } from "../../services/reputation.service";
import { VOTE_QUOTA } from "@community-os/shared/constants";

export const reputationHandler = new Composer<BotContext>();

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
      } else if (mentionEntity?.type === "mention") {
        const username = ctx.message!.text!
          .slice(mentionEntity.offset + 1, mentionEntity.offset + mentionEntity.length)
          .toLowerCase();
        const byUsername = await resolveUserByUsername(username);
        if (byUsername) {
          const score = await reputationService.getScore(byUsername.user.id);
          const displayName = byUsername.user.name ?? "User";
          await ctx.reply(`${displayName}'s reputation score: ${score}`);
          return;
        }
        await ctx.reply("User not found. They may need to register first.");
        return;
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

// /leaderboard command
reputationHandler.command("leaderboard", async (ctx) => {
  try {
    const arg = ctx.match?.trim();
    const limit = arg ? Math.min(Math.max(Number.parseInt(arg, 10) || 10, 1), 50) : 10;

    const rows = await reputationService.getLeaderboard(limit);
    if (rows.length === 0) {
      await ctx.reply("No reputation scores yet.");
      return;
    }

    const lines = rows.map((r, i) => {
      const firstName = (r.userName ?? "Unknown").replace(/_/g, "\\_");
      const handle = r.telegramUsername ? ` (@${r.telegramUsername.replace(/_/g, "\\_")})` : "";
      return `${i + 1}. ${firstName}${handle} - *${r.score} pts*`;
    });

    await ctx.reply(`*Top ${rows.length} Reputation*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    await ctx.reply("Failed to fetch leaderboard. Please try again.");
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
    // no_trigger → silent
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
