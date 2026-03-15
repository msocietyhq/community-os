import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, BotConversation } from "../types";
import { getBotToken } from "../lib/auth";
import { membersService } from "../../services/members.service";
import { loginLinkService } from "../../services/login-link.service";
import { db } from "../../db";
import { account } from "../../db/schema/auth";
import { and, eq } from "drizzle-orm";
import type { CreateMemberInput } from "@community-os/shared/validators";

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

  // Auto-create auth user (or get existing session)
  await conversation.external(() =>
    getBotToken({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    }),
  );

  // Resolve Telegram ID → user ID
  const acct = await conversation.external(() =>
    db
      .select({ userId: account.userId })
      .from(account)
      .where(
        and(
          eq(account.providerId, "telegram"),
          eq(account.accountId, String(from.id)),
        ),
      )
      .then((rows) => rows[0] ?? null),
  );

  if (!acct) {
    await ctx.reply("Something went wrong creating your account. Please try again later.");
    return;
  }

  // Check if already registered
  const existing = await conversation.external(() =>
    membersService.findByUserId(acct.userId),
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
    membersService.create(acct.userId, data),
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
