import { resolve } from "path";
import { db } from "./index";
import { telegramMessages } from "./schema";

const EXPORT_PATH = process.env.EXPORT_PATH ?? Bun.argv[2];
if (!EXPORT_PATH) {
  console.error("Usage: bun run backfill-telegram.ts <path-to-result.json>");
  process.exit(1);
}
const CHAT_ID = "-1001039529025";
const CHAT_TYPE = "supergroup";
const BATCH_SIZE = 500;

interface ExportTextEntity {
  type: string;
  text: string;
}

interface ExportMessage {
  id: number;
  type: string;
  date: string;
  date_unixtime: string;
  from?: string;
  from_id?: string;
  text: string | ExportTextEntity[];
  text_entities?: ExportTextEntity[];
  reply_to_message_id?: number;
  forwarded_from?: string;
  forwarded_from_id?: string;
  media_type?: string;
  edited_unixtime?: string;
  [key: string]: unknown;
}

interface ExportData {
  name: string;
  type: string;
  id: number;
  messages: ExportMessage[];
}

function flattenText(text: string | ExportTextEntity[]): string | null {
  if (typeof text === "string") return text || null;
  if (Array.isArray(text)) {
    const joined = text.map((t) => (typeof t === "string" ? t : t.text)).join("");
    return joined || null;
  }
  return null;
}

function normalizeMediaType(mt: string | undefined): string | null {
  if (!mt) return null;
  if (mt === "video_file") return "video";
  if (mt === "voice_message") return "voice";
  if (mt === "audio_file") return "audio";
  return mt;
}

function parseUserId(fromId: string | undefined): number | null {
  if (!fromId) return null;
  const raw = fromId.startsWith("user") ? fromId.slice(4) : fromId;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

function toRow(msg: ExportMessage): typeof telegramMessages.$inferInsert {
  return {
    chatId: CHAT_ID,
    chatType: CHAT_TYPE,
    messageId: msg.id,
    date: new Date(parseInt(msg.date_unixtime, 10) * 1000),
    fromUserId: parseUserId(msg.from_id),
    fromFirstName: msg.from ?? null,
    fromIsBot: false,
    text: flattenText(msg.text),
    entities: msg.text_entities ?? null,
    replyToMessageId: msg.reply_to_message_id ?? null,
    forwardFromFirstName: msg.forwarded_from ?? null,
    forwardFromUserId: parseUserId(msg.forwarded_from_id),
    mediaType: normalizeMediaType(msg.media_type),
    editDate: msg.edited_unixtime ? new Date(parseInt(msg.edited_unixtime, 10) * 1000) : null,
    raw: msg as unknown as Record<string, unknown>,
  };
}

async function backfill() {
  console.log(`Reading export from: ${resolve(EXPORT_PATH)}`);
  const data: ExportData = JSON.parse(await Bun.file(EXPORT_PATH).text());

  const messages = data.messages.filter((m) => m.type === "message");
  const total = messages.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  console.log(`Found ${total} regular messages (${data.messages.length} total). Inserting in ${batches} batches...`);

  let inserted = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE).map(toRow);
    await db.insert(telegramMessages).values(batch).onConflictDoNothing();
    inserted += batch.length;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Batch ${batchNum}/${batches} — ${inserted}/${total} messages processed`);
  }

  console.log("Backfill complete.");
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
