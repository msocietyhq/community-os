/**
 * Resolve a Telegram user ID to a community-os user.
 * Used by the bot to authenticate actions on behalf of users.
 */
export async function resolveUser(telegramId: string) {
  // TODO: Call member service to resolve telegram_id → user
  // This will look up the members table by telegram_id
  // and return the associated user + member data
  return null;
}

/**
 * Get or create a bearer token for a Telegram user.
 * Used for authenticated service calls from the bot.
 */
export async function getBotToken(telegramId: string): Promise<string | null> {
  // TODO: Implement bot token resolution
  // Options:
  // 1. Use a service API key that includes telegram_id in headers
  // 2. Create a special bot session for the user
  return null;
}
