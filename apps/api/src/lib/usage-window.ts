/**
 * Parses a human time window into a start date.
 *
 * The agent picks this string from whatever a member typed — "last week",
 * "past 3 months", "this year" — so parsing is forgiving and always resolves
 * to something rather than erroring. An unparseable window falls back to the
 * default rather than failing the tool call.
 */

export interface UsageWindow {
  since: Date;
  /** Human description, so the agent can say what it actually measured. */
  label: string;
}

export const DEFAULT_WINDOW = "30d";

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function startOfDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Accepts `7d`, `2w`, `3m`, `1y`, bare numbers of days, and the words
 * `today`, `yesterday`, `week`, `month`, `year`, `ytd`, `all`.
 */
export function resolveWindow(
  spec: string | undefined,
  now: Date = new Date(),
): UsageWindow {
  const raw = (spec ?? DEFAULT_WINDOW).trim().toLowerCase();

  if (raw === "all" || raw === "ever" || raw === "all time") {
    return { since: new Date(0), label: "all time" };
  }
  if (raw === "today") {
    return { since: startOfDay(now), label: "today" };
  }
  if (raw === "yesterday") {
    return { since: daysAgo(startOfDay(now), 1), label: "since yesterday" };
  }
  if (raw === "ytd" || raw === "this year") {
    return {
      since: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      label: "year to date",
    };
  }
  if (raw === "week" || raw === "this week" || raw === "last week") {
    return { since: daysAgo(now, 7), label: "the last 7 days" };
  }
  if (raw === "month" || raw === "this month" || raw === "last month") {
    return { since: daysAgo(now, 30), label: "the last 30 days" };
  }
  if (raw === "year" || raw === "last year") {
    return { since: monthsAgo(now, 12), label: "the last 12 months" };
  }

  const match =
    /^(\d+)\s*(d|w|m|y|day|days|week|weeks|month|months|year|years)?$/.exec(
      raw,
    );
  if (match) {
    const n = Number(match[1]);
    const unit = match[2] ?? "d";

    if (n > 0) {
      if (unit.startsWith("w")) {
        return {
          since: daysAgo(now, n * 7),
          label: `the last ${plural(n, "week")}`,
        };
      }
      if (unit.startsWith("m")) {
        return {
          since: monthsAgo(now, n),
          label: `the last ${plural(n, "month")}`,
        };
      }
      if (unit.startsWith("y")) {
        return {
          since: monthsAgo(now, n * 12),
          label: `the last ${plural(n, "year")}`,
        };
      }
      return { since: daysAgo(now, n), label: `the last ${plural(n, "day")}` };
    }
  }

  // Unrecognised — measure something sensible rather than failing the call.
  return {
    since: daysAgo(now, 30),
    label: "the last 30 days (unrecognised window)",
  };
}
