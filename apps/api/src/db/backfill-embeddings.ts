/**
 * One-time backfill script: generates embeddings for all telegram_messages
 * that have text/caption content but no embedding yet.
 *
 * Usage:
 *   bun run --cwd apps/api src/db/backfill-embeddings.ts
 */

import { isNull, and, or, isNotNull, sql } from "drizzle-orm";
import { db } from "./index";
import { telegramMessages } from "./schema";
import { generateEmbeddingsBatch } from "../services/embeddings.service";

const BATCH_SIZE = 200;

const baseFilter = and(
  isNull(telegramMessages.embedding),
  or(isNotNull(telegramMessages.text), isNotNull(telegramMessages.caption)),
);

async function backfillEmbeddings() {
  console.log("[backfill-embeddings] starting...");

  const countResult = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(baseFilter);

  const total = countResult[0]?.total ?? 0;
  console.log(`[backfill-embeddings] ${total} messages to process`);

  let processed = 0;

  while (processed < total) {
    const batch = await db
      .select({
        chatId: telegramMessages.chatId,
        messageId: telegramMessages.messageId,
        text: telegramMessages.text,
        caption: telegramMessages.caption,
      })
      .from(telegramMessages)
      .where(baseFilter)
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    const contents = batch.map((row) => (row.text ?? row.caption)!);
    const embeddings = await generateEmbeddingsBatch(contents);

    // Bulk update: single query with a VALUES list — one DB round-trip per batch
    const valuesList = sql.join(
      batch.map(
        (row, i) =>
          sql`(${row.chatId}, ${row.messageId}, ${`[${embeddings[i]!.join(",")}]`}::vector)`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      UPDATE ${telegramMessages}
      SET embedding = updates.embedding
      FROM (VALUES ${valuesList}) AS updates(chat_id, message_id, embedding)
      WHERE ${telegramMessages.chatId} = updates.chat_id
        AND ${telegramMessages.messageId} = updates.message_id::int
    `);

    processed += batch.length;
    console.log(
      `[backfill-embeddings] ${processed}/${total} (${Math.round((processed / total) * 100)}%)`,
    );
  }

  console.log("[backfill-embeddings] done.");
  process.exit(0);
}

backfillEmbeddings().catch((err) => {
  console.error("[backfill-embeddings] failed:", err);
  process.exit(1);
});
