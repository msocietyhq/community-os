import { eq } from "drizzle-orm";
import type { AiProvider } from "@community-os/shared/ai-catalog";
import { db } from "../db";
import { providerHealth } from "../db/schema";
import { retryDelayMs } from "./provider-backoff";

/**
 * Per-provider credit state, read on every AI call and written only when a
 * provider's balance runs out or comes back.
 *
 * Reads are memoised for 30s, matching `getSettings`. Every AI call needs this,
 * and an outage that takes effect up to 30s late costs at most a handful of
 * extra failed calls — each of which fails over correctly anyway, and each of
 * which invalidates the cache on its way through.
 */
const CACHE_TTL_MS = 30_000;

interface Row {
  state: string;
  downSince: Date | null;
  retryAfter: Date | null;
  failureCount: number;
  notifiedAt: Date | null;
}

let cached: Map<AiProvider, Row> | null = null;
let cachedAt = 0;

async function load(): Promise<Map<AiProvider, Row>> {
  const rows = await db
    .select({
      provider: providerHealth.provider,
      state: providerHealth.state,
      downSince: providerHealth.downSince,
      retryAfter: providerHealth.retryAfter,
      failureCount: providerHealth.failureCount,
      notifiedAt: providerHealth.notifiedAt,
    })
    .from(providerHealth);

  return new Map(
    rows.map((row) => [
      row.provider as AiProvider,
      {
        state: row.state,
        downSince: row.downSince,
        retryAfter: row.retryAfter,
        failureCount: row.failureCount,
        notifiedAt: row.notifiedAt,
      },
    ]),
  );
}

function invalidate(): void {
  cached = null;
  cachedAt = 0;
}

/** Test seam — the cache is module state. */
export function resetProviderHealthCache(): void {
  invalidate();
}

async function snapshot(now: Date): Promise<Map<AiProvider, Row>> {
  if (cached && now.getTime() - cachedAt < CACHE_TTL_MS) return cached;
  cached = await load();
  cachedAt = now.getTime();
  return cached;
}

/**
 * Providers to route around right now.
 *
 * A provider whose `retry_after` has passed is deliberately NOT in this set:
 * that is exactly how the probe happens. Resolution stops substituting, the
 * next call that wants it tries it for real, and the outcome updates the row.
 */
export async function downProviders(
  now: Date = new Date(),
): Promise<Set<AiProvider>> {
  const rows = await snapshot(now);
  const down = new Set<AiProvider>();

  for (const [provider, row] of rows) {
    if (row.state !== "out_of_credit") continue;
    if (row.retryAfter !== null && row.retryAfter.getTime() <= now.getTime()) {
      continue; // due for a probe
    }
    down.add(provider);
  }

  return down;
}

export interface OutageRecord {
  /** True only for the transition into an outage — the DM guard. */
  firstTransition: boolean;
  failureCount: number;
  retryAfter: Date;
}

/** Records a credit failure and extends the backoff. */
export async function markOutOfCredit(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<OutageRecord> {
  const existing = (await snapshot(now)).get(provider);
  const wasDown = existing?.state === "out_of_credit";
  const failureCount = (wasDown ? existing.failureCount : 0) + 1;
  const retryAfter = new Date(now.getTime() + retryDelayMs(failureCount));
  const firstTransition = !wasDown || existing.notifiedAt === null;

  // `downSince` marks the start of the whole outage, so it is preserved across
  // failed probes and only reset when a new outage begins. The update branch
  // deliberately omits it for that reason.
  await db
    .insert(providerHealth)
    .values({
      provider,
      state: "out_of_credit",
      downSince: wasDown ? (existing.downSince ?? now) : now,
      retryAfter,
      failureCount,
      notifiedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerHealth.provider,
      set: {
        state: "out_of_credit",
        ...(wasDown ? {} : { downSince: now }),
        retryAfter,
        failureCount,
        notifiedAt: now,
        updatedAt: now,
      },
    });

  invalidate();
  return { firstTransition, failureCount, retryAfter };
}

/**
 * Records a successful call.
 *
 * @returns true when this call ended an outage — the recovery DM guard.
 */
export async function markHealthy(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<boolean> {
  const existing = (await snapshot(now)).get(provider);
  if (existing === undefined || existing.state === "healthy") return false;

  await db
    .update(providerHealth)
    .set({
      state: "healthy",
      downSince: null,
      retryAfter: null,
      failureCount: 0,
      notifiedAt: null,
      updatedAt: now,
    })
    .where(eq(providerHealth.provider, provider));

  invalidate();
  return true;
}

/** Clears the backoff so the next call probes immediately. */
export async function probeNow(
  provider: AiProvider,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(providerHealth)
    .set({ retryAfter: now, updatedAt: now })
    .where(eq(providerHealth.provider, provider));

  invalidate();
}
