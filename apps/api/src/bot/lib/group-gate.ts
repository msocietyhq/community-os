import type { NextFunction } from "grammy";
import type { BotContext } from "../types";
import { env } from "../../env";
import { decideGroupAccess, shouldAttemptLeave } from "./group-access";

/**
 * Keeps the bot out of every chat except the community group.
 *
 * Registered first, ahead of the DM gate and the message logger: an update
 * from a chat we are about to walk out of must not log a message row, register
 * its sender as a member, or reach a handler that would answer it.
 *
 * Two signals feed it, because either one on its own has a hole:
 *
 * - `my_chat_member` fires the moment the bot is added, which is the only
 *   chance to leave before anyone in that chat sees the bot respond to
 *   anything.
 * - Ordinary updates cover the case where that one never arrived — the bot was
 *   down long enough for the update to expire, or the token was moved between
 *   deployments — and the bot finds itself sitting in a chat it never saw
 *   itself join.
 *
 * Gathers the facts and applies `decideGroupAccess`, the same way dm-gate
 * relates to dm-access.
 */
export async function groupAccessMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return next();

  const decision = decideGroupAccess({
    allowedChatId: env.TELEGRAM_GROUP_ID,
    chatId: chat.id,
    chatType: chat.type,
    botMember: ctx.myChatMember?.new_chat_member,
  });

  if (decision.leave) {
    await leaveForeignChat(ctx);
    return;
  }

  // The bot is out already — a status change we caused by leaving, or someone
  // else kicking us. Nothing downstream wants it.
  if (decision.reason === "already_out") return;

  // `my_chat_member` is only ever about the bot's own membership. Nothing
  // downstream handles it, and letting it through would put whoever changed
  // the bot's status through auto-register's first-message path — including
  // its welcome message.
  if (ctx.myChatMember) return;

  return next();
}

/**
 * Leaves the chat the current update came from, recording who put the bot
 * there so an admin can see it happened without watching Telegram.
 *
 * A failed `leaveChat` is logged rather than thrown: the update is dropped
 * either way, and the retry comes free with the chat's next update.
 */
async function leaveForeignChat(ctx: BotContext): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;
  if (!shouldAttemptLeave(chat.id)) return;

  const actor = ctx.from;
  const who = actor
    ? `@${actor.username ?? actor.first_name} (${actor.id})`
    : "someone unknown";
  // On `my_chat_member` the actor is the person who put the bot here; on any
  // other update they are only whoever happened to speak first.
  const how = ctx.myChatMember ? `added by ${who}` : `noticed via ${who}`;
  const title = "title" in chat ? chat.title : String(chat.id);

  console.warn(
    `[group-guard] leaving ${chat.type} "${title}" (${chat.id}) — ${how}`,
  );

  await ctx.api.leaveChat(chat.id).catch((err) => {
    console.error(`[group-guard] leaveChat failed for ${chat.id}:`, err);
  });
}
