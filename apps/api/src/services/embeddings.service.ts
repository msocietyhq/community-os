import { VoyageAIClient } from "voyageai";
import { isNull, and, or, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { env } from "../env";

const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });

const MODEL = "voyage-3-lite";
const BATCH_SIZE = 128; // voyage-3-lite max batch size

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await client.embed({
    model: MODEL,
    input: text,
    inputType: "document",
  });
  const embedding = response.data?.[0]?.embedding;
  if (!embedding) throw new Error("[embeddings] empty response from Voyage API");
  return embedding;
}

export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await client.embed({
    model: MODEL,
    input: texts,
    inputType: "document",
  });
  const data = response.data;
  if (!data) throw new Error("[embeddings] empty response from Voyage API");
  return data.map((item) => {
    if (!item.embedding) throw new Error("[embeddings] missing embedding in batch response");
    return item.embedding;
  });
}

export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const response = await client.embed({
    model: MODEL,
    input: text,
    inputType: "query",
  });
  const embedding = response.data?.[0]?.embedding;
  if (!embedding) throw new Error("[embeddings] empty response from Voyage API");
  return embedding;
}

const missingEmbeddingFilter = and(
  isNull(telegramMessages.embedding),
  or(isNotNull(telegramMessages.text), isNotNull(telegramMessages.caption)),
);

export async function backfillMissingEmbeddings(): Promise<void> {
  const countResult = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(missingEmbeddingFilter);

  const total = countResult[0]?.total ?? 0;
  if (total === 0) return;

  console.log(`[embeddings] backfilling ${total} messages...`);
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
      .where(missingEmbeddingFilter)
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    const contents = batch.map((row) => (row.text ?? row.caption)!);
    const embeddings = await generateEmbeddingsBatch(contents);

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
      `[embeddings] backfill ${processed}/${total} (${Math.round((processed / total) * 100)}%)`,
    );
  }

  console.log("[embeddings] backfill complete.");
}
