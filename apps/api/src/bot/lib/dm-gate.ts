import type { NextFunction } from "grammy";
import { isRole, type Role } from "@community-os/shared/constants";
import type { BotContext } from "../types";
import { getSettings } from "../../services/bot-settings.service";
import { resolveUser } from "./auth";
import { decideDmAccess, shouldSendDenial } from "./dm-access";

/**
 * Gates every DM before anything else runs.
 *
 * Registered ahead of the message logger, photo sync, session and
 * conversations: a blocked stranger should not cause a profile-photo fetch, a
 * logged message row, or a session write.
 *
 * Gathers the facts and applies `decideDmAccess`, the same way advisor-gate
 * relates to advisor-access.
 */
export async function dmAccessMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (ctx.chat?.type !== "private") return next();

  const from = ctx.from;
  if (!from || from.is_bot) return next();

  const settings = await getSettings();
  const level = settings["dm.access"];

  // Only "everyone" can skip the lookup, and it is no longer the default — so
  // most DMs now cost one indexed resolveUser query. Acceptable: DM volume is
  // low, and the alternative is letting strangers reach the whole command set.
  if (level === "everyone") return next();

  const resolved = await resolveUser(String(from.id));

  // `user.role` is nullable in the schema and defaults to "member" only at the
  // DB level, so an unrecognised or missing value is treated as no record at
  // all — never as an implicit privilege.
  const rawRole = resolved?.user.role;
  const role: Role | null =
    rawRole != null && isRole(rawRole) ? rawRole : resolved ? "member" : null;

  const decision = decideDmAccess({
    level,
    role,
    banned: resolved?.user.banned ?? false,
  });

  if (decision.allowed) return next();

  const reply = settings["dm.deniedReply"];
  if (reply !== null && shouldSendDenial(from.id)) {
    await ctx.reply(reply).catch((err) => {
      console.error("[dm-access] denial reply failed:", err);
    });
  }
}
