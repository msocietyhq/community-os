import type { Role } from "@community-os/shared/constants";
import type { DmAccessLevel } from "@community-os/shared/bot-settings";

/**
 * Who may use the bot in a DM — the testable core.
 *
 * Deliberately free of database and env imports so it can be tested without
 * either, mirroring the advisor-access / advisor-gate split. The middleware
 * that gathers these facts lives in dm-gate.ts.
 */

export interface DmAccessInput {
  level: DmAccessLevel;
  /** null when the sender has no member record at all. */
  role: Role | null;
  banned: boolean;
}

export type DmAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "not_a_member" | "members_blocked" };

/**
 * Decides whether a DM sender may use the bot at all.
 *
 * Admins bypass every level INCLUDING the ban check. A member is banned
 * automatically when they leave the group, and an admin who leaves must not
 * lose access to the settings menu — otherwise `dm.access = admins` plus a
 * departure locks the community out of its own bot with no way back.
 */
export function decideDmAccess({
  level,
  role,
  banned,
}: DmAccessInput): DmAccessDecision {
  if (level === "everyone") return { allowed: true };

  if (role === "admin" || role === "superadmin") return { allowed: true };

  if (level === "admins") {
    return { allowed: false, reason: "members_blocked" };
  }

  const isMember = role !== null && !banned;
  return isMember
    ? { allowed: true }
    : { allowed: false, reason: "not_a_member" };
}

// ── Reply rate limiting ─────────────────────────────────────

/**
 * In-memory, like the chime-in cooldown map. Losing it on deploy only means
 * one person could get a second copy of a refusal, which is not worth a table.
 */
const REPLY_COOLDOWN_MS = 10 * 60 * 1000;
const lastRepliedTo = new Map<number, number>();

export function shouldSendDenial(
  telegramId: number,
  now: number = Date.now(),
): boolean {
  const last = lastRepliedTo.get(telegramId);
  if (last !== undefined && now - last < REPLY_COOLDOWN_MS) return false;
  lastRepliedTo.set(telegramId, now);
  return true;
}

/** Test seam — the map is module state. */
export function resetDenialHistory(): void {
  lastRepliedTo.clear();
}
