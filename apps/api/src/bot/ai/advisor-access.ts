import { aiService } from "../../services/ai.service";
import { hasRecentMessages } from "../../services/messages.service";
import { ADVISOR_TOOL_NAMES, type AdvisorTier } from "./advisor";

/**
 * Gating for the escalation tiers.
 *
 * Two independent limits: a daily spend cap on both advisors, and an
 * activity requirement on the expensive one. Both fail *friendly* — the tool
 * returns a message for the agent to relay rather than erroring, because a
 * silent refusal reads as a bug to the member.
 */

/**
 * Daily advisor spend per member, in USD.
 *
 * Roughly two Opus 5 escalations, or several Sonnet 5 ones. Prompt caching
 * makes each call substantially cheaper than the uncached estimate, so this
 * is more generous in practice than it looks.
 */
export const ADVISOR_DAILY_BUDGET_USD = 0.5;

/** How recently a member must have posted to reach the deepest tier. */
export const ACTIVE_WINDOW_DAYS = 90;

/** Callers whose spend counts against the budget. */
export const ADVISOR_CALLERS = [
  `${ADVISOR_TOOL_NAMES.big}`,
  `${ADVISOR_TOOL_NAMES.bigger}`,
];

export interface AdvisorDenied {
  allowed: false;
  reason: "unknown_sender" | "inactive" | "budget";
  /** Verbatim text for the agent to relay to the member. */
  tellUser: string;
}

export type AdvisorAccess = { allowed: true } | AdvisorDenied;

export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function activeSince(now: Date): Date {
  return new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** Decides access without touching the database — the testable core. */
export function decideAccess(input: {
  tier: AdvisorTier;
  telegramId: number | null;
  isRecentlyActive: boolean;
  spentTodayUsd: number;
}): AdvisorAccess {
  const { tier, telegramId, isRecentlyActive, spentTodayUsd } = input;

  if (telegramId === null) {
    return {
      allowed: false,
      reason: "unknown_sender",
      tellUser:
        "I can't work out who's asking, so I can't reach for deeper reasoning here. Try again from the group chat.",
    };
  }

  if (spentTodayUsd >= ADVISOR_DAILY_BUDGET_USD) {
    return {
      allowed: false,
      reason: "budget",
      tellUser:
        "You've used up today's allowance for deep reasoning — it resets at midnight UTC. I'll answer with what I can work out myself in the meantime.",
    };
  }

  // Only the expensive tier is activity-gated; the cheaper one stays open.
  if (tier === "bigger" && !isRecentlyActive) {
    return {
      allowed: false,
      reason: "inactive",
      tellUser:
        `The deepest reasoning is reserved for members who've been active in the last ${ACTIVE_WINDOW_DAYS} days — say salam in the group and it'll open up. I'll do my best with what I have.`,
    };
  }

  return { allowed: true };
}

/** Gathers the facts and applies `decideAccess`. */
export async function checkAdvisorAccess(
  tier: AdvisorTier,
  telegramId: number | null,
  now: Date = new Date(),
): Promise<AdvisorAccess> {
  if (telegramId === null) {
    return decideAccess({ tier, telegramId, isRecentlyActive: false, spentTodayUsd: 0 });
  }

  const [isRecentlyActive, spentTodayUsd] = await Promise.all([
    // Only the deep tier needs the activity lookup — skip the query otherwise.
    tier === "bigger"
      ? hasRecentMessages(telegramId, activeSince(now)).catch(() => false)
      : Promise.resolve(true),
    aiService
      .getSpendByCaller(telegramId, ADVISOR_CALLERS, startOfDayUtc(now))
      .catch(() => 0),
  ]);

  return decideAccess({ tier, telegramId, isRecentlyActive, spentTodayUsd });
}
