import type { WeeklyDigest } from "../../services/digest.service";

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

function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[\]]/g, "\\$&");
}

function displayName(
  telegramUsername: string | null | undefined,
  name: string | null | undefined,
  firstName?: string | null,
): string {
  if (telegramUsername) return `@${escapeMarkdown(telegramUsername)}`;
  if (name) return escapeMarkdown(name);
  if (firstName) return escapeMarkdown(firstName);
  return "Anonymous";
}

export function formatWeeklyDigest(digest: WeeklyDigest): string {
  const lines: string[] = [];

  // Header
  lines.push("*MSOCIETY Weekly Digest*");
  lines.push(
    `_${SG_DATE.format(digest.periodStart)} — ${SG_DATE.format(digest.periodEnd)}_`,
  );
  lines.push("");

  // Chat Activity
  lines.push("*Chat Activity*");
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
    lines.push("*Welcome New Members*");
    const names = digest.newMembers
      .slice(0, 5)
      .map((m) => displayName(m.telegramUsername, m.name));
    lines.push(names.join(", "));
  }

  // Upcoming Events
  lines.push("");
  lines.push("*Upcoming Events*");
  if (digest.upcomingEvents.length === 0) {
    lines.push("No upcoming events");
  } else {
    for (const [i, e] of digest.upcomingEvents.entries()) {
      const dateStr = `${SG_EVENT_DATE.format(e.startsAt)} · ${SG_TIME.format(e.startsAt)}`;
      lines.push(` ${i + 1}. ${escapeMarkdown(e.title)}`);
      lines.push(`    ${dateStr} — ${e.attendeeCount} going`);
    }
  }

  // New Projects
  if (digest.newProjects.length > 0) {
    lines.push("");
    lines.push("*New Projects*");
    for (const p of digest.newProjects.slice(0, 5)) {
      const owner = displayName(p.ownerTelegramUsername, p.ownerName);
      lines.push(` - ${escapeMarkdown(p.name)} by ${owner}`);
    }
  }

  // Reputation Leaders
  if (digest.reputationLeaders.length > 0) {
    lines.push("");
    lines.push("*Reputation Leaders*");
    for (const [i, r] of digest.reputationLeaders.entries()) {
      const name = displayName(r.telegramUsername, r.userName);
      lines.push(` ${i + 1}. ${name} (${r.score} pts)`);
    }
  }

  return lines.join("\n");
}
