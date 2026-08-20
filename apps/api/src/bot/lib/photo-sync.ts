import { eq } from "drizzle-orm";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types";
import { fetchTelegramPhoto } from "./telegram-user";
import { savePhoto } from "../../services/photos.service";
import { db } from "../../db";
import { user } from "../../db/schema";

/** In-memory map of telegramId → last sync epoch ms */
const lastSyncedAt = new Map<number, number>();
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Middleware that syncs a user's Telegram profile photo to the DB
 * on any interaction (group or private), at most once every 24 hours.
 */
export async function photoSyncMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (!ctx.from || ctx.from.is_bot) {
    return next();
  }

  const telegramId = ctx.from.id;
  const now = Date.now();
  const lastSync = lastSyncedAt.get(telegramId);

  if (lastSync && now - lastSync < SYNC_INTERVAL_MS) {
    return next();
  }

  // Mark synced immediately to avoid concurrent fetches
  lastSyncedAt.set(telegramId, now);

  // Fire-and-forget so the handler isn't delayed
  fetchTelegramPhoto(telegramId, ctx.api)
    .then(async (photo) => {
      if (!photo) return;

      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.telegramId, String(telegramId)))
        .limit(1);
      if (!row) return;

      await savePhoto(row.id, photo.data, photo.contentType);
    })
    .catch((err) => {
      console.warn(`Photo sync failed for telegram ID ${telegramId}:`, err);
      // Allow retry on next interaction
      lastSyncedAt.delete(telegramId);
    });

  return next();
}
