/**
 * Per-Singapore-day memoisation, used by the tech news roundup.
 *
 * Split out from tech-news.service so it can be tested without dragging in the
 * database, the AI client and `env` — which validates at import time and throws
 * when the test runner hasn't loaded apps/api/.env. Same reasoning as the
 * advisor-access / advisor-gate and chime-in / chime-in-judge pairs: the logic
 * is pure, the I/O lives next door.
 */

const SGT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` as it reads in Singapore — the cache rolls over at midnight SGT. */
export function sgtDayKey(at: Date = new Date()): string {
  return SGT_DAY.format(at);
}

/**
 * Memoises one value per Singapore calendar day.
 *
 * A roundup costs several searches, up to 14 GitHub calls and a Sonnet call, so
 * `/technews` run twice in a row should not pay for it twice — and shouldn't
 * return a *different* answer either, since the model reranks on every run.
 *
 * In-memory on purpose: a deploy dropping the cache costs one regeneration,
 * which is cheaper than the table and migration persisting it would need.
 *
 * Concurrent callers share one in-flight load, so spamming the command while
 * the first is still running doesn't fan out into parallel generations. A
 * rejected load is never cached, so a transient failure retries next time.
 */
export function dailyCache<T>(load: () => Promise<T>) {
  let cachedDay: string | null = null;
  let cachedValue: T | undefined;
  let inFlight: Promise<T> | null = null;
  let inFlightDay: string | null = null;

  return async function get(
    opts: { force?: boolean; now?: Date } = {},
  ): Promise<T> {
    const today = sgtDayKey(opts.now);

    if (!opts.force) {
      if (cachedDay === today) return cachedValue as T;
      if (inFlight && inFlightDay === today) return inFlight;
    }

    inFlightDay = today;
    inFlight = load()
      .then((value) => {
        cachedDay = today;
        cachedValue = value;
        return value;
      })
      .finally(() => {
        inFlight = null;
        inFlightDay = null;
      });

    return inFlight;
  };
}
