import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { aiService } from "../../services/ai.service";

type Range = "1m" | "6m" | "1y" | "ytd" | "all";

const RANGE_LABELS: Record<Range, string> = {
  "1m": "1M",
  "6m": "6M",
  "1y": "1Y",
  ytd: "YTD",
  all: "All-time",
};

const RANGE_TITLES: Record<Range, string> = {
  "1m": "Past one month",
  "6m": "Past six months",
  "1y": "Past year",
  ytd: "Year-to-date",
  all: "All-time",
};

function getSinceDate(range: Range): Date | null {
  const now = new Date();
  switch (range) {
    case "1m":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "6m":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return null;
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function buildKeyboard(username?: string): InlineKeyboard {
  const prefix = username ? `usage:${username}:` : "usage::";
  const kb = new InlineKeyboard();

  const row1: Range[] = ["1m", "6m", "1y"];
  const row2: Range[] = ["ytd", "all"];

  for (const r of row1) {
    kb.text(RANGE_LABELS[r], `${prefix}${r}`);
  }
  kb.row();
  for (const r of row2) {
    kb.text(RANGE_LABELS[r], `${prefix}${r}`);
  }

  return kb;
}

function getMonthsInRange(since: Date): number {
  const now = new Date();
  const months =
    (now.getFullYear() - since.getFullYear()) * 12 +
    (now.getMonth() - since.getMonth()) +
    (now.getDate() >= since.getDate() ? 0 : -1);
  return Math.max(months, 1);
}

function formatUsageBlock(
  summary: { inputTokens: number; outputTokens: number; estimatedCost: number },
  months: number,
): string {
  const avgIn = Math.round(summary.inputTokens / months);
  const avgOut = Math.round(summary.outputTokens / months);

  return (
    `${formatTokens(summary.inputTokens)} in / ${formatTokens(summary.outputTokens)} out\n\n` +
    `Monthly average:\n` +
    `${formatTokens(avgIn)} in / ${formatTokens(avgOut)} out\n\n` +
    `Estimated Cost: ${formatCost(summary.estimatedCost)}`
  );
}

async function buildMessage(
  range: Range,
  username?: string,
): Promise<{ text: string; telegramUserId?: number; notFound?: boolean }> {
  const rangeDescription = RANGE_TITLES[range];
  const since = getSinceDate(range);
  // Use epoch start for "all-time"
  const sinceDate = since ?? new Date(0);
  const months = getMonthsInRange(sinceDate);

  if (username) {
    const resolved = await aiService.resolveUserByUsername(username);
    if (!resolved?.telegramId) {
      return { text: `User @${username} not found.`, notFound: true };
    }

    const telegramUserId = Number(resolved.telegramId);
    const summary = await aiService.getUsageSummary(sinceDate, telegramUserId);

    return {
      text:
        `*🤖 AI Usage*\n` +
        `_${rangeDescription}_\n\n` +
        `Tokens used by @${resolved.telegramUsername ?? username}:\n` +
        formatUsageBlock(summary, months),
      telegramUserId,
    };
  }

  const summary = await aiService.getUsageSummary(sinceDate);

  return {
    text:
      `*🤖 AI Usage*\n` +
      `_${rangeDescription}_\n\n` +
      `Tokens used:\n` +
      formatUsageBlock(summary, months),
  };
}

export const usageHandler = new Composer<BotContext>();

usageHandler.command("usage", async (ctx) => {
  const isPrivate = ctx.chat?.type === "private";

  // Extract @username mention from the message (skip the bot_command entity)
  const mention = ctx.message?.entities?.find((e) => e.type === "mention" && e.offset > 0);
  let username: string | undefined;
  if (mention && ctx.message?.text) {
    username = ctx.message.text.substring(mention.offset + 1, mention.offset + mention.length);
  } else if (isPrivate && ctx.from?.username) {
    username = ctx.from.username;
  }

  const result = await buildMessage("ytd", username);

  await ctx.reply(result.text, {
    parse_mode: "Markdown",
    reply_markup: result.notFound ? undefined : buildKeyboard(username),
  });
});

// Callback: usage:<username>:<range>
usageHandler.callbackQuery(/^usage:([^:]*):(\w+)$/, async (ctx) => {
  const username = ctx.match![1] || undefined;
  const range = ctx.match![2] as Range;

  if (!RANGE_LABELS[range]) {
    await ctx.answerCallbackQuery({ text: "Invalid range." });
    return;
  }

  const { text } = await buildMessage(range, username);
  const keyboard = buildKeyboard(username);

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});
