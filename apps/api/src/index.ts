import { app } from "./app";
import { initBot, shutdownBot } from "./bot/init";
import { backfillMissingMembers } from "./db/backfill-members";
import { backfillMissingEmbeddings } from "./services/embeddings.service";
import { backfillInlinePhotos } from "./scripts/backfill-photos";
import { reputationService } from "./services/reputation.service";
import { calibrateRecall } from "./services/recall-calibration";
import { aiProfileService } from "./services/ai-profile.service";
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

// Builds AI profiles for members who have never had one, so a deploy picks up
// new joiners. Self-limiting — every member it touches gets stamped, so after
// the first run this finds only genuine newcomers, usually none.
//
// Production only, and deliberately so: unlike the other backfills above this
// one spends money (a model call and an embedding per member), and `bun dev`
// runs with --watch, so without the guard every file save would re-trigger it.
if (process.env.NODE_ENV === "production") {
  aiProfileService.backfillMissing().catch((err) => {
    console.error("AI profile backfill failed:", err);
  });
} else {
  console.log(
    "AI profile backfill skipped (NODE_ENV is not production) — " +
      "run aiProfileService.backfillMissing() by hand to test it",
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
