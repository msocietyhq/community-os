/**
 * How long a provider stays out of rotation after a failed probe.
 *
 * 30 minutes first so a top-up within the hour is picked up quickly; 24 hours
 * at the cap so an outage nobody acts on costs about three wasted round trips
 * a day instead of forty-eight. A probe is not free: it rides on a real
 * member's call and costs them one failed request before the substitute answers.
 *
 * Pure, so it is tested without a clock or a database.
 */
const MINUTE_MS = 60_000;

export const BACKOFF_STEPS_MS = [
  30 * MINUTE_MS,
  60 * MINUTE_MS,
  120 * MINUTE_MS,
  240 * MINUTE_MS,
  480 * MINUTE_MS,
  1440 * MINUTE_MS,
] as const;

/** @param failureCount consecutive failed probes, 1 for the first failure. */
export function retryDelayMs(failureCount: number): number {
  const index = Math.min(
    Math.max(Math.trunc(failureCount), 1),
    BACKOFF_STEPS_MS.length,
  );
  return BACKOFF_STEPS_MS[index - 1]!;
}
