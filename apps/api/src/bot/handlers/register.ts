import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, BotConversation } from "../types";
import { createTelegramUser } from "../lib/auth";
import { membersService } from "../../services/members.service";
import { loginLinkService } from "../../services/login-link.service";
import type { CreateMemberInput } from "@community-os/shared/validators";
import { env } from "../../env";

function isSkip(text: string): boolean {
  return text.trim().toLowerCase() === "skip";
}

function parseTitleCompany(text: string): { title?: string; company?: string } {
  const match = text.match(/^(.+?)\s+at\s+(.+)$/i);
  if (match?.[1] && match[2]) {
    return { title: match[1].trim(), company: match[2].trim() };
  }
  return { title: text.trim() };
}

function parseCsvList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function registerConversation(conversation: BotConversation, ctx: BotContext) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  // Verify user is a member of the MSOCIETY Telegram group
  if (env.TELEGRAM_GROUP_ID) {
    const member = await conversation.external(async () => {
      try {
        return await ctx.api.getChatMember(env.TELEGRAM_GROUP_ID!, from.id);
      } catch {
        return null;
      }
    });

    const allowed = member && !["left", "kicked"].includes(member.status);
    if (!allowed) {
      await ctx.reply(
        "You must be a member of the MSOCIETY Telegram group to register.\n\n" +
          "MSOCIETY is invite-only — ask an existing member to add you to the group, then come back and send /register again.",
      );
      return;
    }
  }

  // Create auth user + account (or get existing)
  const userId = await conversation.external(() =>
    createTelegramUser({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    }),
  );

  // Check if already registered
  const existing = await conversation.external(() =>
    membersService.findByUserId(userId),
  );

  if (existing) {
    const loginLink = await conversation.external(() =>
      loginLinkService.createLoginLink({
        id: from.id,
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
      }),
    );
    await ctx.reply(
      "You're already registered! Open the portal to update your profile:",
      { reply_markup: new InlineKeyboard().url("Open MSOCIETY", loginLink) },
    );
    return;
  }

  // Start questionnaire
  await ctx.reply(
    "Let's set up your MSOCIETY profile! I'll ask you a few questions.\n" +
      'Type "skip" to skip any question.\n\n' +
      "1/5 — Tell us about yourself (max 500 chars):",
  );

  const data: CreateMemberInput = {};

  // 1. Bio
  const bioReply = await conversation.form.text();
  if (!isSkip(bioReply)) {
    data.bio = bioReply.slice(0, 500);
  }

  // 2. Title + Company
  await ctx.reply('2/5 — What do you do? (e.g. "Software Engineer at Grab"):');
  const titleReply = await conversation.form.text();
  if (!isSkip(titleReply)) {
    const { title, company } = parseTitleCompany(titleReply);
    data.currentTitle = title;
    data.currentCompany = company;
  }

  // 3. Skills
  await ctx.reply("3/5 — Your skills? (comma-separated, e.g. TypeScript, React, Python):");
  const skillsReply = await conversation.form.text();
  if (!isSkip(skillsReply)) {
    data.skills = parseCsvList(skillsReply);
  }

  // 4. Interests
  await ctx.reply("4/5 — Your interests? (comma-separated, e.g. AI, Web Dev, Open Source):");
  const interestsReply = await conversation.form.text();
  if (!isSkip(interestsReply)) {
    data.interests = parseCsvList(interestsReply);
  }

  // 5. GitHub
  await ctx.reply("5/5 — Your GitHub username:");
  const githubReply = await conversation.form.text();
  if (!isSkip(githubReply)) {
    data.githubHandle = githubReply.replace(/^@/, "").trim();
  }

  // Create member
  await conversation.external(() =>
    membersService.create(userId, data),
  );

  // Build summary
  const lines = ["Your MSOCIETY profile has been created!\n"];
  if (data.bio) lines.push(`Bio: ${data.bio}`);
  if (data.currentTitle) {
    const role = data.currentCompany
      ? `${data.currentTitle} at ${data.currentCompany}`
      : data.currentTitle;
    lines.push(`Role: ${role}`);
  }
  if (data.skills?.length) lines.push(`Skills: ${data.skills.join(", ")}`);
  if (data.interests?.length) lines.push(`Interests: ${data.interests.join(", ")}`);
  if (data.githubHandle) lines.push(`GitHub: ${data.githubHandle}`);

  const loginLink = await conversation.external(() =>
    loginLinkService.createLoginLink({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    }),
  );
  await ctx.reply(lines.join("\n"), {
    reply_markup: new InlineKeyboard().url("Open MSOCIETY", loginLink),
  });
}

export const registerHandler = new Composer<BotContext>();

registerHandler.use(createConversation(registerConversation));

registerHandler.command("register", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply(
      "Please use this command in a private chat with me.",
    );
    return;
  }

  await ctx.conversation.enter("registerConversation");
});
