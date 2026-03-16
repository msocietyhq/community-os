import type { Api, RawApi } from "grammy";
import type { User } from "grammy/types";
import type { TelegramUser } from "./auth";
import { env } from "../../env";

/**
 * Build a TelegramUser from grammY's User, optionally fetching the
 * profile photo as a base64 data URL so it can be stored without expiry.
 */
export async function telegramUserFromContext(
  from: User,
  api: Api<RawApi>,
): Promise<TelegramUser> {
  let photo_url: string | undefined;

  try {
    const photos = await api.getUserProfilePhotos(from.id, { limit: 1 });
    if (photos.total_count > 0 && photos.photos[0]) {
      // Last element = highest resolution
      const sizes = photos.photos[0];
      const best = sizes[sizes.length - 1];
      if (best) {
        const file = await api.getFile(best.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(url);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const base64 = Buffer.from(buf).toString("base64");
            photo_url = `data:image/jpeg;base64,${base64}`;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch profile photo for telegram ID ${from.id}:`, err);
  }

  return {
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
    photo_url,
  };
}
