export type CallClass = "interactive" | "background";

export type BudgetVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: "background_paused" | "daily_cap" | "monthly_cap";
    };

export interface BudgetInput {
  callClass: CallClass;
  backgroundPaused: boolean;
  spentTodayUsd: number;
  spentMonthUsd: number;
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
}

/**
 * Decides whether an AI call may proceed. Pure — the caller gathers the facts.
 *
 * Caps bind background AND interactive calls. A pause that stopped members
 * while the crons kept spending would defeat the purpose of pausing during a
 * cost spike, which is the situation these exist for.
 */
export function decideBudget(input: BudgetInput): BudgetVerdict {
  if (input.callClass === "background" && input.backgroundPaused) {
    return { allowed: false, reason: "background_paused" };
  }

  if (input.dailyCapUsd !== null && input.spentTodayUsd >= input.dailyCapUsd) {
    return { allowed: false, reason: "daily_cap" };
  }

  if (
    input.monthlyCapUsd !== null &&
    input.spentMonthUsd >= input.monthlyCapUsd
  ) {
    return { allowed: false, reason: "monthly_cap" };
  }

  return { allowed: true };
}

/** Thrown by the ai.service gate so callers fail loudly rather than silently. */
export class AiBudgetError extends Error {
  constructor(public readonly reason: string) {
    super(`AI call blocked: ${reason}`);
    this.name = "AiBudgetError";
  }
}
