import { Cron } from "croner";
import { bot } from "../bot";
import {
  digestService,
  previousCalendarMonth,
} from "../../services/digest.service";
import { getWeeklyTechNews } from "../../services/tech-news.service";
import { formatMonthlyDigest } from "./digest-formatter";
import { formatHistoryDigest } from "./history-digest-formatter";
import { formatTechNews } from "./tech-news-formatter";
import { env } from "../../env";
import { aiProfileService } from "../../services/ai-profile.service";

let monthlyDigestCron: Cron | null = null;
let historyDigestCron: Cron | null = null;
let techNewsCron: Cron | null = null;
let aiProfileCron: Cron | null = null;

const SGT = { timezone: "Asia/Singapore" } as const;

/**
 * Post to the community group's General topic.
 *
 * Omitting `message_thread_id` is what routes a message to General in a forum
 * supergroup, and is a no-op in a plain group — so scheduled broadcasts land in
 * the main channel either way, never buried in whichever topic was last active.
 */
async function broadcast(
  label: string,
  message: string | string[],
  parseMode: "Markdown" | "HTML",
): Promise<boolean> {
  const groupId = env.TELEGRAM_GROUP_ID;
  if (!groupId) {
    console.warn(`${label} skipped: TELEGRAM_GROUP_ID not set`);
    return false;
  }

  // Sequential, not parallel: Telegram doesn't guarantee ordering across
  // concurrent sends, and a roundup split mid-section would read backwards.
  const parts = Array.isArray(message) ? message : [message];
  for (const part of parts) {
    await bot.api.sendMessage(groupId, part, {
      parse_mode: parseMode,
      link_preview_options: { is_disabled: true },
    });
  }

  console.log(
    `${label} sent successfully${parts.length > 1 ? ` (${parts.length} messages)` : ""}`,
  );
  return true;
}

/** Start the scheduled community posts. */
export function startDigestScheduler(): void {
  if (!monthlyDigestCron) {
    // 1st of the month at 9am SGT, covering the month that just ended — so the
    // numbers describe a closed period rather than a moving window.
    monthlyDigestCron = new Cron("0 9 1 * *", SGT, async () => {
      try {
        const digest = await digestService.generateMonthlyDigest(
          previousCalendarMonth(),
        );
        await broadcast("Monthly digest", formatMonthlyDigest(digest), "Markdown");
      } catch (err) {
        console.error("Failed to send monthly digest:", err);
      }
    });

    console.log("Monthly digest scheduler started (1st at 9am SGT)");
  }

  if (!historyDigestCron) {
    // Mid-month at 9am SGT, clear of the 1st-of-month digest. Most months this
    // posts nothing: the flashback only goes out when the model judges the
    // material genuinely worth resurfacing.
    historyDigestCron = new Cron("0 9 15 * *", SGT, async () => {
      try {
        const history = await digestService.getThisMonthInHistory();
        if (!history) {
          console.log("History digest skipped: nothing interesting enough");
          return;
        }

        await broadcast("History digest", formatHistoryDigest(history), "HTML");
      } catch (err) {
        console.error("Failed to send history digest:", err);
      }
    });

    console.log("History digest scheduler started (15th at 9am SGT)");
  }

  if (!techNewsCron) {
    // Monday 9am SGT — the slot the weekly digest used to occupy.
    techNewsCron = new Cron("0 9 * * 1", SGT, async () => {
      try {
        // Shared with `/technews`: whoever runs the command later that day sees
        // exactly what was posted here, not a freshly reranked variant.
        const news = await getWeeklyTechNews();
        if (!news) {
          console.log("Tech news skipped: nothing worth posting");
          return;
        }

        await broadcast("Tech news", formatTechNews(news), "HTML");
      } catch (err) {
        console.error("Failed to send tech news:", err);
      }
    });

    console.log("Tech news scheduler started (Monday 9am SGT)");
  }

  if (!aiProfileCron) {
    // Monthly, 4am SGT on the 1st — off-peak and well clear of the 9am digest.
    //
    // Monthly rather than nightly because a profile is a slow-moving summary of
    // who someone is; a day of chat rarely changes it enough to be worth a model
    // call per member. New joiners don't wait for this — the boot backfill picks
    // them up on the next deploy.
    aiProfileCron = new Cron("0 4 1 * *", SGT, async () => {
      try {
        await aiProfileService.regenerateStale();
      } catch (err) {
        console.error("Failed to regenerate AI profiles:", err);
      }
    });

    console.log("AI profile scheduler started (monthly, 1st at 4am SGT)");
  }
}

/** Stop all scheduled posts. */
export function stopDigestScheduler(): void {
  for (const job of [
    monthlyDigestCron,
    historyDigestCron,
    techNewsCron,
    aiProfileCron,
  ]) {
    job?.stop();
  }
  monthlyDigestCron = null;
  historyDigestCron = null;
  techNewsCron = null;
  aiProfileCron = null;
}
