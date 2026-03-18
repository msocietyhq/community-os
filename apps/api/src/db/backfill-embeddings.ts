/**
 * Standalone backfill script — wraps the same logic used at server startup.
 *
 * Usage:
 *   bun run --cwd apps/api src/db/backfill-embeddings.ts
 */

import { backfillMissingEmbeddings } from "../services/embeddings.service";

backfillMissingEmbeddings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-embeddings] failed:", err);
    process.exit(1);
  });
