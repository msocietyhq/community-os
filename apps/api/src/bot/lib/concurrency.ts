/**
 * Chat identifier used both as the session key and as the sequentialize
 * constraint. Same chat waits; other chats run in parallel.
 *
 * Returning undefined leaves the update unconstrained — there is no chat to
 * collide with.
 */
export function concurrencyKey(ctx: {
  chat?: { id: number };
}): string | undefined {
  return ctx.chat ? String(ctx.chat.id) : undefined;
}
