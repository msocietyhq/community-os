import { describe, expect, it } from "bun:test";
import type { ChatMember } from "grammy/types";
import { isPresentChatMember } from "./telegram-membership";

const user = {
  id: 1,
  is_bot: false,
  first_name: "Test",
};

describe("isPresentChatMember", () => {
  it("counts creators, administrators and plain members as present", () => {
    const present: ChatMember[] = [
      { status: "creator", user, is_anonymous: false },
      {
        status: "administrator",
        user,
        is_anonymous: false,
        can_be_edited: false,
        can_manage_chat: true,
        can_change_info: false,
        can_delete_messages: false,
        can_invite_users: false,
        can_restrict_members: false,
        can_pin_messages: false,
        can_promote_members: false,
        can_manage_video_chats: true,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false,
        can_manage_topics: false,
      },
      { status: "member", user },
    ];

    for (const member of present) {
      expect(isPresentChatMember(member)).toBe(true);
    }
  });

  it("counts users who left or were kicked as absent", () => {
    expect(isPresentChatMember({ status: "left", user })).toBe(false);
    expect(isPresentChatMember({ status: "kicked", user, until_date: 0 })).toBe(
      false,
    );
  });

  // The distinction that a status-only check gets wrong: both of these are
  // "restricted", but only one of them is still in the group.
  it("splits restricted users on is_member", () => {
    const restricted = {
      status: "restricted",
      user,
      until_date: 0,
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_topics: false,
      can_edit_tag: false,
    } as const;

    expect(isPresentChatMember({ ...restricted, is_member: true })).toBe(true);
    expect(isPresentChatMember({ ...restricted, is_member: false })).toBe(
      false,
    );
  });
});
