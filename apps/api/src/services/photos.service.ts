import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { user, userPhoto } from "../db/schema/auth";
import { env } from "../env";

export interface StoredPhoto {
  data: Buffer;
  contentType: string;
  updatedAt: Date;
}

/**
 * Stored form of a photo reference: a root-relative path.
 *
 * Deliberately not absolute. An absolute URL bakes the environment into the
 * row, so a script run against the wrong API_URL rewrites every avatar to
 * point at the wrong host. Callers serving the web resolve it with
 * `absolutePhotoUrl`.
 */
export function photoPath(userId: string): string {
  return `/api/v1/members/${userId}/photo`;
}

/**
 * SQL form of `absolutePhotoUrl`, for use inside a `.select()` column map
 * where `user.image` is a column reference rather than a value.
 */
export function photoUrlSql() {
  return sql<
    string | null
  >`case when ${user.image} like '/%' then ${env.API_URL} || ${user.image} else ${user.image} end`;
}

/** Resolves a stored image value to something a browser can load. */
export function absolutePhotoUrl(image: string | null): string | null {
  if (!image) return null;
  return image.startsWith("/") ? `${env.API_URL}${image}` : image;
}

/**
 * Stores photo bytes and points `user.image` at the photo route.
 *
 * Both writes happen together — a URL with no bytes behind it renders as a
 * broken avatar everywhere it appears.
 */
export async function savePhoto(
  userId: string,
  data: Buffer,
  contentType = "image/jpeg",
): Promise<string> {
  await db.transaction(async (tx) => {
    await tx
      .insert(userPhoto)
      .values({ userId, data, contentType, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userPhoto.userId,
        set: { data, contentType, updatedAt: new Date() },
      });

    await tx
      .update(user)
      .set({ image: photoPath(userId) })
      .where(eq(user.id, userId));
  });

  return photoPath(userId);
}

export async function getPhoto(userId: string): Promise<StoredPhoto | null> {
  const [row] = await db
    .select({
      data: userPhoto.data,
      contentType: userPhoto.contentType,
      updatedAt: userPhoto.updatedAt,
    })
    .from(userPhoto)
    .where(eq(userPhoto.userId, userId))
    .limit(1);

  return row ?? null;
}

/** Parses a `data:<type>;base64,<payload>` URI. Used to migrate old rows. */
export function parseDataUri(
  value: string,
): { data: Buffer; contentType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;

  const [, contentType, payload] = match;
  if (!contentType || !payload) return null;

  try {
    return { data: Buffer.from(payload, "base64"), contentType };
  } catch {
    return null;
  }
}
