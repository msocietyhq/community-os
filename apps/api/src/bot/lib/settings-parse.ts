import {
  BOT_SETTINGS,
  type SettingKey,
  type SettingValue,
} from "@community-os/shared/bot-settings";

export type ParseResult<K extends SettingKey> =
  | { ok: true; value: SettingValue<K> }
  | { ok: false; error: string };

/**
 * Turns a callback-data fragment back into a real setting value.
 *
 * Every branch ends at the registry schema, so a malformed callback — a stale
 * button from before a deploy, or a hand-crafted one — fails here rather than
 * writing nonsense into the settings table.
 */
export function parseEditValue<K extends SettingKey>(
  key: K,
  raw: string,
  now: Date = new Date(),
): ParseResult<K> {
  const def = BOT_SETTINGS[key];
  let candidate: unknown;

  switch (def.control) {
    case "pause": {
      if (raw === "inf") candidate = { state: "paused" };
      else if (raw === "0") candidate = { state: "active" };
      else {
        const minutes = Number(raw);
        if (!Number.isFinite(minutes)) {
          return { ok: false, error: "Bad duration." };
        }
        candidate = {
          state: "paused_until",
          until: new Date(now.getTime() + minutes * 60_000),
        };
      }
      break;
    }
    case "toggle":
      candidate = raw === "true";
      break;
    case "money":
    case "duration":
    case "percent": {
      if (raw === "none") {
        candidate = null;
        break;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: "That isn't a number." };
      }
      candidate = value;
      break;
    }
    case "choice": {
      if (key === "availability.quietHours") {
        if (raw === "off") candidate = null;
        else {
          const [start, end] = raw.split("-");
          candidate = { start, end };
        }
      } else {
        candidate = raw;
      }
      break;
    }
    case "text":
      candidate = raw === "none" ? null : raw;
      break;
  }

  const parsed = def.schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "That value isn't valid." };

  return { ok: true, value: parsed.data as SettingValue<K> };
}
