import { and, desc, eq } from "drizzle-orm";
import {
  BOT_SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  type SettingsSnapshot,
} from "@community-os/shared/bot-settings";
import { db } from "../db";
import { auditLog, botSettings, user } from "../db/schema";
import { createAuditEntry } from "../middleware/audit";

export type ChangeSource = "menu" | "ai_draft";

export interface Actor {
  userId: string;
  source: ChangeSource;
  rationale?: string;
}

export interface AppliedChange {
  key: SettingKey;
  from: unknown;
  to: unknown;
}

interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Merges stored overrides over the registry defaults.
 *
 * A stored value that no longer parses — a removed setting, a retyped one —
 * falls back to its default rather than throwing. A bad row in this table must
 * never be able to take the bot down.
 */
export function buildSnapshot(rows: SettingRow[]): SettingsSnapshot {
  const overrides = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};

  for (const key of SETTING_KEYS) {
    const def = BOT_SETTINGS[key];
    const raw = overrides.get(key);

    if (raw === undefined) {
      out[key] = def.default;
      continue;
    }

    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[settings] ${key} stored value is invalid, using default`);
      out[key] = def.default;
      continue;
    }

    out[key] = parsed.data;
  }

  return out as SettingsSnapshot;
}

// ── Cache ───────────────────────────────────────────────────

/**
 * The bot changes settings from inside its own process, so a local write
 * invalidates synchronously and applies to the very next message. The TTL only
 * exists to pick up a write from a second Railway replica or a future web UI.
 */
const CACHE_TTL_MS = 30_000;

let cache: { snapshot: SettingsSnapshot; loadedAt: number } | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function getSettings(now = Date.now()): Promise<SettingsSnapshot> {
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.snapshot;

  const rows = await db
    .select({ key: botSettings.key, value: botSettings.value })
    .from(botSettings);

  const snapshot = buildSnapshot(rows);
  cache = { snapshot, loadedAt: now };
  return snapshot;
}

// ── Writes ──────────────────────────────────────────────────

async function writeOne(
  key: SettingKey,
  value: unknown,
  actor: Actor,
): Promise<void> {
  await db
    .insert(botSettings)
    .values({ key, value, updatedBy: actor.userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSettings.key,
      set: { value, updatedBy: actor.userId, updatedAt: new Date() },
    });
}

async function audit(
  key: SettingKey,
  action: "update" | "reset" | "undo",
  from: unknown,
  to: unknown,
  actor: Actor,
): Promise<void> {
  await createAuditEntry({
    entityType: "bot_setting",
    entityId: key,
    action,
    oldValue: { value: from },
    newValue: { value: to, source: actor.source, rationale: actor.rationale },
    performedBy: actor.userId,
  });
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  actor: Actor,
): Promise<AppliedChange> {
  const before = await getSettings();
  const from = before[key];

  await writeOne(key, value, actor);
  invalidateSettingsCache();
  await audit(key, "update", from, value, actor);

  return { key, from, to: value };
}

export async function resetSetting(
  key: SettingKey,
  actor: Actor,
): Promise<AppliedChange> {
  const before = await getSettings();
  const from = before[key];
  const to = BOT_SETTINGS[key].default;

  await db.delete(botSettings).where(eq(botSettings.key, key));
  invalidateSettingsCache();
  await audit(key, "reset", from, to, actor);

  return { key, from, to };
}

/**
 * Applies a whole draft in one transaction, so a half-applied change set is
 * impossible. The cache is invalidated once, after the transaction commits.
 */
export async function applyChanges(
  changes: AppliedChange[],
  actor: Actor,
): Promise<AppliedChange[]> {
  if (changes.length === 0) return [];

  await db.transaction(async (tx) => {
    for (const change of changes) {
      await tx
        .insert(botSettings)
        .values({
          key: change.key,
          value: change.to,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: botSettings.key,
          set: {
            value: change.to,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          },
        });
    }
  });

  invalidateSettingsCache();

  for (const change of changes) {
    await audit(change.key, "update", change.from, change.to, actor);
  }

  return changes;
}

// ── History ─────────────────────────────────────────────────

export interface HistoryActor {
  id: string;
  /**
   * How the actor is shown to an admin. The Telegram handle where there is
   * one — it is short, unambiguous, and taps through to the profile — falling
   * back to the account name, which is a decorated display name more often
   * than not.
   */
  name: string;
}

export interface HistoryEntry {
  key: string;
  action: string;
  from: unknown;
  to: unknown;
  source: string | null;
  /** Why, for a change the AI drafted. Null for a menu change. */
  rationale: string | null;
  /** Null for a change with no recorded actor — a migration or a seed. */
  actor: HistoryActor | null;
  at: Date | null;
}

interface ValueBag {
  value?: unknown;
  source?: unknown;
  rationale?: unknown;
}

function readBag(raw: unknown): ValueBag {
  return raw !== null && typeof raw === "object" ? (raw as ValueBag) : {};
}

function readActor(
  id: string | null,
  name: string | null,
  username: string | null,
): HistoryActor | null {
  if (id === null) return null;
  // The join misses when the account has since been deleted; the id is still
  // evidence that a person, not the system, made the change.
  return { id, name: username ? `@${username}` : (name ?? "unknown") };
}

export async function getHistory(
  key: SettingKey | null,
  limit = 20,
  offset = 0,
): Promise<HistoryEntry[]> {
  const where =
    key === null
      ? eq(auditLog.entityType, "bot_setting")
      : and(eq(auditLog.entityType, "bot_setting"), eq(auditLog.entityId, key));

  // Joined rather than resolved per row: the page renders up to twenty
  // entries, and an id is not something an admin can read.
  const rows = await db
    .select({
      entityId: auditLog.entityId,
      action: auditLog.action,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      performedBy: auditLog.performedBy,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      actorUsername: user.telegramUsername,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.performedBy))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => {
    const newBag = readBag(row.newValue);
    return {
      key: row.entityId,
      action: row.action,
      from: readBag(row.oldValue).value,
      to: newBag.value,
      source: typeof newBag.source === "string" ? newBag.source : null,
      rationale: typeof newBag.rationale === "string" ? newBag.rationale : null,
      actor: readActor(row.performedBy, row.actorName, row.actorUsername),
      at: row.createdAt,
    };
  });
}

/**
 * Reverts a setting to the previous value recorded in the audit trail.
 *
 * The previous value is read from the trail rather than carried in the
 * callback: a welcome template is far longer than Telegram's whole 64-byte
 * callback budget, so encoding it was never an option.
 */
export async function undoSetting(
  key: SettingKey,
  actor: Actor,
): Promise<AppliedChange | null> {
  const [latest] = await getHistory(key, 1);
  if (!latest) return null;

  const def = BOT_SETTINGS[key];
  const parsed = def.schema.safeParse(latest.from);
  const target = parsed.success ? parsed.data : def.default;

  const before = await getSettings();
  const from = before[key];

  await writeOne(key, target, actor);
  invalidateSettingsCache();
  await audit(key, "undo", from, target, actor);

  return { key, from, to: target };
}

export const botSettingsService = {
  getSettings,
  invalidateSettingsCache,
  setSetting,
  resetSetting,
  applyChanges,
  undoSetting,
  getHistory,
};
