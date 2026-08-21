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

// Re-derives the memory recall floor from the corpus. Cheap (pure SQL over
// stored vectors) and self-correcting as the corpus changes character.
calibrateRecall().catch((err) => {
  console.error("Recall calibration failed:", err);
});

// Rebuilds memories from chat history, then builds AI profiles from them.
//
// Chained, not parallel: profiles are generated from memories, so running both
// at once would build profiles against a half-filled corpus and then stamp them
// as done — leaving thin profiles that nothing would revisit until the prompt
// version changes again.
//
// Both are idempotent and resume after a restart: the memory pass stamps each
// message it considers, the profile pass stamps each member. Once drained they
// cost one count query per boot.
//
// Production only, and deliberately so: unlike the other backfills above these
// spend money, and `bun dev` runs with --watch, so without the guard every file
// save would re-trigger them.
if (process.env.NODE_ENV === "production") {
  backfillMemories()
    .then(() => aiProfileService.backfillMissing())
    .catch((err) => {
      console.error("Memory/profile backfill failed:", err);
    });
} else {
  console.log(
    "Memory + AI profile backfill skipped (NODE_ENV is not production) — " +
      "run backfillMemories() then aiProfileService.backfillMissing() by hand",
  );
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
