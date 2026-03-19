import { Cron } from "croner";
import { bot } from "../bot";
import { digestService } from "../../services/digest.service";
import { formatWeeklyDigest } from "./digest-formatter";
import { formatHistoryDigest } from "./history-digest-formatter";
import { env } from "../../env";

let weeklyDigestCron: Cron | null = null;
let historyDigestCron: Cron | null = null;

/** Start the weekly digest cron job — every Monday at 9am SGT. */
export function startDigestScheduler(): void {
  if (!weeklyDigestCron) {
    weeklyDigestCron = new Cron(
      "0 9 * * 1",
      { timezone: "Asia/Singapore" },
      async () => {
        try {
          const groupId = env.TELEGRAM_GROUP_ID;
          if (!groupId) {
            console.warn("Digest skipped: TELEGRAM_GROUP_ID not set");
            return;
          }

          const digest = await digestService.generateWeeklyDigest();
          const message = formatWeeklyDigest(digest);

          await bot.api.sendMessage(groupId, message, {
            parse_mode: "Markdown",
          });

          console.log("Weekly digest sent successfully");
        } catch (err) {
          console.error("Failed to send weekly digest:", err);
        }
      },
    );

    console.log("Digest scheduler started (Monday 9am SGT)");
  }

  if (!historyDigestCron) {
    historyDigestCron = new Cron(
      "0 9 * * 5",
      { timezone: "Asia/Singapore" },
      async () => {
        try {
          const groupId = env.TELEGRAM_GROUP_ID;
          if (!groupId) {
            console.warn(
              "History digest skipped: TELEGRAM_GROUP_ID not set",
            );
            return;
          }

          const history = await digestService.getThisWeekInHistory();
          if (!history) {
            console.log(
              "History digest skipped: no historical data found",
            );
            return;
          }

          const message = formatHistoryDigest(history);

          const canReply =
            history.replyToMessageId &&
            history.replyToChatId === groupId;

          await bot.api.sendMessage(groupId, message, {
            parse_mode: "Markdown",
            ...(canReply
              ? { reply_to_message_id: history.replyToMessageId }
              : {}),
          });

          console.log("History digest sent successfully");
        } catch (err) {
          console.error("Failed to send history digest:", err);
        }
      },
    );

    console.log("History digest scheduler started (Friday 9am SGT)");
  }
}

/** Stop all digest cron jobs. */
export function stopDigestScheduler(): void {
  if (weeklyDigestCron) {
    weeklyDigestCron.stop();
    weeklyDigestCron = null;
  }
  if (historyDigestCron) {
    historyDigestCron.stop();
    historyDigestCron = null;
  }
}
