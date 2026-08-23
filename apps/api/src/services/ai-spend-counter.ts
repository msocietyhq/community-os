import { gte, sql } from "drizzle-orm";
import { db } from "../db";
import { aiUsage } from "../db/schema";

/**
 * Running community spend, seeded from ai_usage and incremented locally.
 *
 * Querying ai_usage before every AI call would be far too expensive, so the
 * totals are held in process and re-read periodically.
 *
 * KNOWN LIMITATION: with more than one API replica each holds a partial view,
 * so a cap can overshoot by up to REFRESH_MS worth of spend before converging.
 * Accepted for a soft budget guard. A hard ceiling would need SELECT … FOR
 * UPDATE per call and real added latency.
 */
const REFRESH_MS = 60_000;

type EstimateCost = (
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
) => number;

let dayKey: string | null = null;
let monthKey: string | null = null;
let daySpendUsd = 0;
let monthSpendUsd = 0;
let refreshedAt = 0;
let alertedForDay: string | null = null;

function keys(now: Date): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function startOfDayUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function sumSince(since: Date, estimate: EstimateCost): Promise<number> {
  const rows = await db
    .select({
      model: aiUsage.model,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
      cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since))
    .groupBy(aiUsage.model);

  return rows.reduce(
    (total, row) =>
      total +
      estimate(
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
      ),
    0,
  );
}

export interface Spend {
  todayUsd: number;
  monthUsd: number;
}

export async function getSpend(
  now: Date,
  estimate: EstimateCost,
): Promise<Spend> {
  const current = keys(now);
  const rolledOver = current.day !== dayKey || current.month !== monthKey;
  const stale = now.getTime() - refreshedAt >= REFRESH_MS;

  if (rolledOver || stale) {
    const [today, month] = await Promise.all([
      sumSince(startOfDayUtc(now), estimate),
      sumSince(startOfMonthUtc(now), estimate),
    ]);

    daySpendUsd = today;
    monthSpendUsd = month;
    dayKey = current.day;
    monthKey = current.month;
    refreshedAt = now.getTime();
  }

  return { todayUsd: daySpendUsd, monthUsd: monthSpendUsd };
}

/** Called after a successful call so the counter tracks between refreshes. */
export function addSpend(usd: number): void {
  daySpendUsd += usd;
  monthSpendUsd += usd;
}

/**
 * True at most once per UTC day, the first time the day's spend crosses the
 * threshold. Returns false when no threshold is set.
 */
export function shouldAlert(
  now: Date,
  threshold: number | null,
  spentTodayUsd: number,
): boolean {
  if (threshold === null) return false;
  if (spentTodayUsd < threshold) return false;

  const day = now.toISOString().slice(0, 10);
  if (alertedForDay === day) return false;

  alertedForDay = day;
  return true;
}

/** Test seam — the counter is module state. */
export function resetSpendCounter(): void {
  dayKey = null;
  monthKey = null;
  daySpendUsd = 0;
  monthSpendUsd = 0;
  refreshedAt = 0;
  alertedForDay = null;
}
