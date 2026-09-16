/**
 * Boot-time cleanup of remote execs left behind when the API process died.
 *
 * Lives here rather than in exec.ts so the reaper's settings lookup (and its
 * env-validated DB import) cannot leak into exec unit tests.
 */

import { getSettings } from "../../services/bot-settings.service";
import { execConfigFromSnapshot, reapOrphanedExecs } from "./exec";

export async function reapOrphanedComputerExecs(): Promise<void> {
  const config = execConfigFromSnapshot(await getSettings());
  const outcome = await reapOrphanedExecs(config);
  if (outcome.skipped) {
    console.log("[computer] exec reaper skipped — computer not configured");
    return;
  }
  if ("error" in outcome.result) {
    console.error("[computer] exec reaper:", outcome.result.error);
    return;
  }
  console.log(
    "[computer] exec reaper finished",
    outcome.result.timedOut
      ? "timed out"
      : `exit ${String(outcome.result.exitCode)}`,
  );
}
