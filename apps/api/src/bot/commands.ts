/**
 * The bot's advertised command list — the single source for Telegram's command
 * menu and for /help.
 *
 * These drifted before: six registered commands never made it into /help, and
 * the menu was maintained by hand in BotFather. Deriving all three from one
 * array means adding a command is one entry, and the menu can no longer offer
 * something /help has never heard of.
 *
 * Not every registered command belongs here. Internal and one-off triggers stay
 * unadvertised on purpose; this is the list members are meant to discover.
 */
export interface BotCommandDef {
  /** Lowercase, digits and underscores only — Telegram rejects anything else. */
  command: string;
  /** Shown in the command menu and in /help. Telegram caps this at 256. */
  description: string;
  /** Leading icon for the /help listing. Not sent to Telegram. */
  icon: string;
}

export const BOT_COMMANDS: BotCommandDef[] = [
  { command: "events", description: "View upcoming events", icon: "📅" },
  { command: "projects", description: "Browse community projects", icon: "🚀" },
  {
    command: "create_project",
    description: "Submit a new project",
    icon: "➕",
  },
  {
    command: "reputation",
    description: "Check your reputation score",
    icon: "⭐",
  },
  { command: "leaderboard", description: "Top reputation scores", icon: "🏆" },
  {
    command: "vote_quota",
    description: "Votes you have left in the last 24h",
    icon: "🗳️",
  },
  { command: "technews", description: "This week's tech roundup", icon: "📰" },
  { command: "usage", description: "View your AI usage stats", icon: "📊" },
  { command: "models", description: "List available AI models", icon: "🧠" },
  {
    command: "profile",
    description: "View or edit your community profile",
    icon: "👤",
  },
  {
    command: "login",
    description: "Get a login link for the web portal (DM)",
    icon: "🔑",
  },
  {
    command: "settings",
    description: "Configure the bot (admins only, DM)",
    icon: "⚙️",
  },
  { command: "help", description: "Show this help message", icon: "❓" },
];

/** The payload `setMyCommands` takes — icons stripped, order preserved. */
export function telegramCommands(): { command: string; description: string }[] {
  return BOT_COMMANDS.map(({ command, description }) => ({
    command,
    description,
  }));
}

/** The /help body, one icon-prefixed line per command. */
export function helpLines(): string {
  return BOT_COMMANDS.map(
    (c) => `${c.icon} /${c.command} — ${c.description}`,
  ).join("\n");
}

/** The /start body. Same list, no icons — it reads as prose there. */
export function startLines(): string {
  return BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`).join("\n");
}
