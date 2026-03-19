import { app } from "./app";
import { initBot, shutdownBot } from "./bot/init";
import { backfillMissingMembers } from "./db/backfill-members";
import { backfillMissingEmbeddings } from "./services/embeddings.service";
import { reputationService } from "./services/reputation.service";
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

reputationService.recalculateAllScores().catch((err) => {
  console.error("Reputation recalculation failed:", err);
});

const shutdown = async () => {
  console.log("Shutting down...");
  await shutdownBot();
  app.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type { App } from "./app";
