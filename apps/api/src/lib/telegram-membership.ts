import type { ChatMember } from "grammy/types";

/**
 * Whether a `getChatMember` result means the user is currently in the chat.
 *
 * Telegram reports six statuses and only some of them mean "present". The
 * subtle one is `restricted`, which covers both a muted member who is still in
 * the group and one who has been restricted after leaving — `is_member` is the
 * only thing that separates those two, and reading the status alone counts
 * departed users as present.
 *
 * Lives outside members.service.ts so it can be tested without pulling in
 * `env` and the bot instance.
 */
export function isPresentChatMember(member: ChatMember): boolean {
  switch (member.status) {
    case "creator":
    case "administrator":
    case "member":
      return true;
    case "restricted":
      return member.is_member;
    case "left":
    case "kicked":
      return false;
  }
}
