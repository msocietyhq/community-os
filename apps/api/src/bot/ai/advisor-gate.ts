import { aiService } from "../../services/ai.service";
import { hasRecentMessages } from "../../services/messages.service";
import type { AdvisorTier } from "./advisor";
import {
  ADVISOR_CALLERS,
  activeSince,
  decideAccess,
  startOfDayUtc,
  type AdvisorAccess,
} from "./advisor-access";

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
