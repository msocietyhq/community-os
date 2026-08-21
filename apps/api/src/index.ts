import { app } from "./app";
import { initBot, shutdownBot } from "./bot/init";
import { backfillMissingMembers } from "./db/backfill-members";
import { backfillMissingEmbeddings } from "./services/embeddings.service";
import { backfillInlinePhotos } from "./scripts/backfill-photos";
import { reputationService } from "./services/reputation.service";
import { calibrateRecall } from "./services/recall-calibration";
import { aiProfileService } from "./services/ai-profile.service";
import { backfillMemories } from "./services/memory-backfill.service";
import { env } from "./env";

app.listen(env.PORT);

console.log(
  `MSOCIETY community-os API running at ${app.server?.hostname}:${app.server?.port}`,
);

initBot().catch((err) => {
  console.error("Failed to initialize bot:", err);
});

backfillMissingMembers().catch((err) => {
  console.error("Member backfill failed:", err);
});

backfillMissingEmbeddings().catch((err) => {
  console.error("Embedding backfill failed:", err);
});

// Moves any base64 data URIs still sitting in user.image into user_photo.
// Idempotent and a no-op once drained.
backfillInlinePhotos().catch((err) => {
  console.error("Photo backfill failed:", err);
});

reputationService.recalculateAllScores().catch((err) => {
  console.error("Reputation recalculation failed:", err);
});

// Chained because each step reads what the previous one wrote: calibration
// derives the recall floor from the corpus, profiles are generated from it.
// All three are idempotent and resume after a restart.
//
// Production only — the first two spend money and `bun dev` runs with --watch.
if (process.env.NODE_ENV === "production") {
  backfillMemories()
    .then(() => calibrateRecall())
    .then(() => aiProfileService.backfillMissing())
    .catch((err) => {
      console.error("Memory/calibration/profile backfill failed:", err);
    });
} else {
  console.log(
    "Memory + AI profile backfill skipped (NODE_ENV is not production) — " +
      "run backfillMemories() then aiProfileService.backfillMissing() by hand",
  );
  // Read-only, so it still runs outside production.
  calibrateRecall().catch((err) => {
    console.error("Recall calibration failed:", err);
  });
}

const shutdown = async () => {
  console.log("Shutting down...");
  await shutdownBot();
  app.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type { App } from "./app";
