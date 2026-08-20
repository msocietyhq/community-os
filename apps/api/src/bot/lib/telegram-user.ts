import type { Api, RawApi } from "grammy";
import type { User } from "grammy/types";
import type { TelegramUser } from "./auth";
import { env } from "../../env";

/**
 * Build a TelegramUser from grammY's User.
 *
 * Deliberately does not touch the profile photo. This is called on nearly
 * every interaction (/profile, /login, /token, auto-register), and it used to
 * download and base64-encode the member's photo each time — both slow and the
 * source of 144KB data URIs in `user.image`. Photos are fetched by the
 * photo-sync middleware, which is rate-limited to once per day per member.
 */
export function telegramUserFromContext(from: User): TelegramUser {
  return {
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
  };
}

export interface FetchedPhoto {
  data: Buffer;
  contentType: string;
}

/**
 * Downloads a member's highest-resolution Telegram profile photo.
 *
 * Telegram's own file URLs expire, so the bytes are kept; they are stored in
 * `user_photo` and served from our own route rather than inlined anywhere.
 */
export async function fetchTelegramPhoto(
  telegramId: number,
  api: Api<RawApi>,
): Promise<FetchedPhoto | null> {
  try {
    const photos = await api.getUserProfilePhotos(telegramId, { limit: 1 });

    if (photos.total_count === 0 || !photos.photos[0]) {
      console.warn(
        `[photo-sync] telegram ID ${telegramId}: no visible profile photos (total_count=${photos.total_count})`,
      );
      return null;
    }

    // Last element = highest resolution.
    const sizes = photos.photos[0];
    const best = sizes[sizes.length - 1];
    if (!best) return null;

    const file = await api.getFile(best.file_id);
    if (!file.file_path) {
      console.warn(
        `[photo-sync] telegram ID ${telegramId}: getFile returned no file_path (file_id=${best.file_id})`,
      );
      return null;
    }

    const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[photo-sync] telegram ID ${telegramId}: file download failed with status ${res.status}`,
      );
      return null;
    }

    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  } catch (err) {
    console.warn(`Failed to fetch profile photo for telegram ID ${telegramId}:`, err);
    return null;
  }
}
