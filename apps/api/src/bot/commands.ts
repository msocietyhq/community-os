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
  /**
   * Handler rejects group chats outright ("use this in a private chat").
   * Such a command is a dead row in a group, so it is filtered out of both
   * the group command menu and the group /help.
   */
  dmOnly?: boolean;
}

export const BOT_COMMANDS: BotCommandDef[] = [
  { command: "events", description: "View upcoming events", icon: "📅" },
  { command: "projects", description: "Browse community projects", icon: "🚀" },
  {
    command: "create_project",
    description: "Submit a new project",
    icon: "➕",
    dmOnly: true,
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
    dmOnly: true,
  },
  {
    command: "login",
    description: "Get a login link for the web portal",
    icon: "🔑",
    dmOnly: true,
  },
  {
    command: "settings",
    description: "Configure the bot (admins only)",
    icon: "⚙️",
    dmOnly: true,
  },
  { command: "help", description: "Show this help message", icon: "❓" },
];

/**
 * The commands usable in this chat type.
 *
 * The DM-only ones aren't hidden for tidiness — their handlers refuse a group
 * outright, so listing them there offers something that cannot work.
 */
export function commandsFor(inPrivate: boolean): BotCommandDef[] {
  return inPrivate ? BOT_COMMANDS : BOT_COMMANDS.filter((c) => !c.dmOnly);
}

/** The payload `setMyCommands` takes — icons stripped, order preserved. */
export function telegramCommands(
  inPrivate: boolean,
): { command: string; description: string }[] {
  return commandsFor(inPrivate).map(({ command, description }) => ({
    command,
    description,
  }));
}

/** The /help body, one icon-prefixed line per command. */
export function helpLines(inPrivate: boolean): string {
  return commandsFor(inPrivate)
    .map((c) => `${c.icon} /${c.command} — ${c.description}`)
    .join("\n");
}

/** The /start body. Same list, no icons — it reads as prose there. */
export function startLines(inPrivate: boolean): string {
  return commandsFor(inPrivate)
    .map((c) => `/${c.command} — ${c.description}`)
    .join("\n");
}
