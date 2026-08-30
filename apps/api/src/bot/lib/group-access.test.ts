import { describe, expect, test } from "bun:test";
import type { ChatMember } from "grammy/types";
import {
  decideGroupAccess,
  resetLeaveAttempts,
  shouldAttemptLeave,
} from "./group-access";

const OUR_GROUP = "-1001234567890";

const botUser = { id: 42, is_bot: true, first_name: "MSocietyBot" };

const present: ChatMember = { status: "member", user: botUser };
const left: ChatMember = { status: "left", user: botUser };
const kicked: ChatMember = { status: "kicked", user: botUser, until_date: 0 };

const decide = (input: Partial<Parameters<typeof decideGroupAccess>[0]>) =>
  decideGroupAccess({
    allowedChatId: OUR_GROUP,
    chatId: "-1009999999999",
    chatType: "supergroup",
    ...input,
  });

describe("decideGroupAccess", () => {
  test("leaves a group someone else added the bot to", () => {
    const decision = decide({ botMember: present });
    expect(decision.leave).toBe(true);
    if (decision.leave) expect(decision.reason).toBe("foreign_chat");
  });

  test("leaves a basic group as well as a supergroup", () => {
    expect(decide({ chatType: "group", botMember: present }).leave).toBe(true);
  });

  // A bot added to a channel is added as an administrator, so skipping
  // channels would leave it holding posting rights in a stranger's broadcast.
  test("leaves a channel", () => {
    expect(decide({ chatType: "channel", botMember: present }).leave).toBe(
      true,
    );
  });

  test("leaves a foreign chat found from an ordinary message", () => {
    // No `botMember`: the `my_chat_member` update never arrived, and the only
    // evidence of where the bot is, is the traffic it can see.
    expect(decide({ botMember: undefined }).leave).toBe(true);
  });

  test("stays in the community group", () => {
    const decision = decide({ chatId: OUR_GROUP, botMember: present });
    expect(decision.leave).toBe(false);
    if (!decision.leave) expect(decision.reason).toBe("own_group");
  });

  test("matches the community group given a numeric chat id", () => {
    expect(decide({ chatId: Number(OUR_GROUP) }).leave).toBe(false);
  });

  test("never leaves a DM", () => {
    const decision = decide({ chatType: "private", chatId: 777 });
    expect(decision.leave).toBe(false);
    if (!decision.leave) expect(decision.reason).toBe("private");
  });

  // Leaving on an unset group id would walk out of the real group too. The
  // DM gate still applies, and initBot warns at startup.
  test("stays put when no community group is configured", () => {
    const decision = decide({ allowedChatId: undefined });
    expect(decision.leave).toBe(false);
    if (!decision.leave) expect(decision.reason).toBe("unconfigured");
  });

  test("does not leave a chat it is already out of", () => {
    for (const botMember of [left, kicked]) {
      const decision = decide({ botMember });
      expect(decision.leave).toBe(false);
      if (!decision.leave) expect(decision.reason).toBe("already_out");
    }
  });

  test("treats a restricted-but-absent bot as already out", () => {
    const restricted = {
      status: "restricted",
      user: botUser,
      is_member: false,
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
    } satisfies ChatMember;

    expect(decide({ botMember: restricted }).leave).toBe(false);
    expect(decide({ botMember: { ...restricted, is_member: true } }).leave).toBe(
      true,
    );
  });
});

describe("shouldAttemptLeave", () => {
  test("allows the first attempt and throttles the burst behind it", () => {
    resetLeaveAttempts();
    const now = Date.now();

    expect(shouldAttemptLeave(-100, now)).toBe(true);
    expect(shouldAttemptLeave(-100, now + 1_000)).toBe(false);
    expect(shouldAttemptLeave(-100, now + 60_000)).toBe(false);
  });

  test("retries once the window passes, so a failed leave isn't final", () => {
    resetLeaveAttempts();
    const now = Date.now();

    expect(shouldAttemptLeave(-100, now)).toBe(true);
    expect(shouldAttemptLeave(-100, now + 5 * 60 * 1000)).toBe(true);
  });

  test("throttles each chat separately", () => {
    resetLeaveAttempts();
    const now = Date.now();

    expect(shouldAttemptLeave(-100, now)).toBe(true);
    expect(shouldAttemptLeave(-200, now)).toBe(true);
  });

  test("keys on the id, not its type", () => {
    resetLeaveAttempts();
    const now = Date.now();

    expect(shouldAttemptLeave(-100, now)).toBe(true);
    expect(shouldAttemptLeave("-100", now)).toBe(false);
  });
});
