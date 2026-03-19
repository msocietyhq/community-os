import { Cron } from "croner";
import { bot } from "../bot";
import { digestService } from "../../services/digest.service";
import { formatWeeklyDigest } from "./digest-formatter";
import { env } from "../../env";

let cronJob: Cron | null = null;

/** Start the weekly digest cron job — every Monday at 9am SGT. */
export function startDigestScheduler(): void {
  if (cronJob) return;

  cronJob = new Cron("0 9 * * 1", { timezone: "Asia/Singapore" }, async () => {
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
  });

  console.log("Digest scheduler started (Monday 9am SGT)");
}

/** Stop the weekly digest cron job. */
export function stopDigestScheduler(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
