import { FormattedString } from "@grammyjs/parse-mode";
import type { MonthlyDigest } from "../../services/digest.service";
import { formatCompact } from "../../lib/text";

const SG_DATE = new Intl.DateTimeFormat("en-SG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Singapore",
});

const SG_EVENT_DATE = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Singapore",
});

const SG_TIME = new Intl.DateTimeFormat("en-SG", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Singapore",
});

/**
 * No escaping: names go into the text verbatim and any styling is carried by
 * entities. A member called `*Ali*` or `a_b` used to need escaping here, and a
 * missed one broke the whole message.
 */
function displayName(
  telegramUsername: string | null | undefined,
  name: string | null | undefined,
  firstName?: string | null,
): string {
  if (telegramUsername) return `@${telegramUsername}`;
  return name || firstName || "Anonymous";
}

export function formatMonthlyDigest(digest: MonthlyDigest): FormattedString {
  const lines: (FormattedString | string)[] = [];

  // Header
  lines.push(FormattedString.b("MSOCIETY Monthly Digest"));
  lines.push(
    FormattedString.i(
      `${SG_DATE.format(digest.periodStart)} — ${SG_DATE.format(digest.periodEnd)}`,
    ),
  );
  lines.push("");

  // Chat Activity
  lines.push(FormattedString.b("Chat Activity"));
  lines.push(`Messages: ${digest.totalMessages}`);
  lines.push(`Active members: ${digest.uniqueActiveMembers}`);

  if (digest.topContributors.length > 0) {
    lines.push("");
    lines.push("Top contributors:");
    for (const [i, c] of digest.topContributors.entries()) {
      const name = displayName(c.fromUsername, null, c.fromFirstName);
      lines.push(` ${i + 1}. ${name} (${c.messageCount} msgs)`);
    }
  }

  // New Members
  if (digest.newMembers.length > 0) {
    lines.push("");
    lines.push(FormattedString.b("Welcome New Members"));
    lines.push(
      digest.newMembers
        .slice(0, 5)
        .map((m) => displayName(m.telegramUsername, m.name))
        .join(", "),
    );
  }

  // Upcoming Events
  lines.push("");
  lines.push(FormattedString.b("Upcoming Events"));
  if (digest.upcomingEvents.length === 0) {
    lines.push("No upcoming events");
  } else {
    for (const [i, e] of digest.upcomingEvents.entries()) {
      lines.push(` ${i + 1}. ${e.title}`);
      lines.push(
        `    ${SG_EVENT_DATE.format(e.startsAt)} · ${SG_TIME.format(e.startsAt)} — ${e.attendeeCount} going`,
      );
    }
  }

  // New Projects
  if (digest.newProjects.length > 0) {
    lines.push("");
    lines.push(FormattedString.b("New Projects"));
    for (const p of digest.newProjects.slice(0, 5)) {
      const owner = displayName(p.ownerTelegramUsername, p.ownerName);
      lines.push(` - ${p.name} by ${owner}`);
    }
  }

  // Reputation Leaders
  if (digest.reputationLeaders.length > 0) {
    lines.push("");
    lines.push(FormattedString.b("Reputation"));
    for (const [i, r] of digest.reputationLeaders.entries()) {
      const name = displayName(r.telegramUsername, r.userName);
      lines.push(` ${i + 1}. ${name} (+${r.score} pts)`);
    }
  }

  // AI Usage
  if (digest.aiUsage.length > 0) {
    lines.push("");
    lines.push(FormattedString.b("AI Usage"));
    for (const [i, u] of digest.aiUsage.entries()) {
      const name = displayName(u.telegramUsername, u.firstName);
      lines.push(` ${i + 1}. ${name} (${formatCompact(u.totalTokens)} tokens)`);
    }
  }

  return FormattedString.join(lines, "\n");
}
