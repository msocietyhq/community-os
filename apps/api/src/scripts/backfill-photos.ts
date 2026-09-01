/**
 * Moves base64 data URIs out of `user.image` into the `user_photo` table.
 *
 * Idempotent: only touches rows whose image is still a data URI, and each move
 * is transactional (savePhoto writes the bytes and the URL together), so a
 * failure part-way leaves the original data URI intact.
 *
 * Usage: bun run src/scripts/backfill-photos.ts
 */
import { sql, like, and, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { savePhoto, parseDataUri } from "../services/photos.service";

export async function backfillInlinePhotos(): Promise<void> {
  // Repair any row whose image was stamped with an absolute host by an
  // earlier run — the stored form is a root-relative path.
  const repaired = await db
    .update(user)
    .set({ image: sql`'/api/v1/members/' || ${user.id} || '/photo'` })
    .where(like(user.image, "http%/api/v1/members/%/photo"))
    .returning({ id: user.id });
  if (repaired.length > 0) {
    console.log(
      `[backfill-photos] repaired ${repaired.length} absolute URLs to relative paths`,
    );
  }

  const rows = await db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .where(and(isNotNull(user.image), like(user.image, "data:%")));

  if (rows.length === 0 && repaired.length === 0) return;
  console.log(`[backfill-photos] found ${rows.length} inline photos`);

  let moved = 0;
  let failed = 0;
  let bytesFreed = 0;

  for (const row of rows) {
    const parsed = row.image ? parseDataUri(row.image) : null;
    if (!parsed) {
      console.warn(
        `[backfill-photos] ${row.name}: unparseable data URI, skipping`,
      );
      failed++;
      continue;
    }

    try {
      const url = await savePhoto(row.id, parsed.data, parsed.contentType);
      bytesFreed += row.image?.length ?? 0;
      moved++;
      console.log(
        `[backfill-photos] ${row.name}: ${(row.image?.length ?? 0).toLocaleString()} chars → ${url}`,
      );
    } catch (err) {
      failed++;
      console.error(`[backfill-photos] ${row.name}: failed:`, err);
    }
  }

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user)
    .where(and(isNotNull(user.image), like(user.image, "data:%")));

  console.log(`\n[backfill-photos] === COMPLETE ===`);
  console.log(`[backfill-photos] moved: ${moved}, failed: ${failed}`);
  console.log(
    `[backfill-photos] removed ${bytesFreed.toLocaleString()} chars (~${Math.round(bytesFreed / 4)} tokens) from the user table`,
  );
  console.log(
    `[backfill-photos] inline photos remaining: ${remaining?.n ?? 0}`,
  );
}

// Allow running standalone: bun run src/scripts/backfill-photos.ts
if (import.meta.main) {
  backfillInlinePhotos()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[backfill-photos] fatal:", err);
      process.exit(1);
    });
}
