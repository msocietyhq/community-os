import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, BotConversation } from "../types";
import { createTelegramUser } from "../lib/auth";
import { telegramUserFromContext } from "../lib/telegram-user";
import { membersService } from "../../services/members.service";
import type { CreateMemberInput } from "@community-os/shared/validators";
import { env } from "../../env";

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

async function askQuestion(
  conversation: BotConversation,
  ctx: BotContext,
  prompt: string,
): Promise<string | null> {
  const keyboard = new InlineKeyboard().text("Skip ⏭", "skip_step");
  await ctx.reply(prompt, { reply_markup: keyboard });
  const response = await conversation.wait();
  if (response.callbackQuery?.data === "skip_step") {
    await response.answerCallbackQuery();
    return null;
  }
  return response.message?.text ?? null;
}

async function setProfileConversation(conversation: BotConversation, ctx: BotContext) {
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
        "You must be a member of the MSOCIETY Telegram group to set up your profile.\n\n" +
          "MSOCIETY is invite-only — ask an existing member to add you to the group, then come back and try again.",
      );
      return;
    }
  }

  // Build TelegramUser once (includes profile photo fetch)
  const telegramUser = await conversation.external(() =>
    telegramUserFromContext(from, ctx.api),
  );

  // Create auth user + account (or get existing)
  const userId = await conversation.external(() =>
    createTelegramUser(telegramUser),
  );

  // Check if member already exists (for create vs update)
  const existing = await conversation.external(() =>
    membersService.findByUserId(userId),
  );

  // Start questionnaire
  await ctx.reply(
    "Let's set up your MSOCIETY profile! I'll ask you a few questions.\n" +
      "Press Skip to skip any question.\n\n" +
      "1/5 — Tell us about yourself (max 500 chars):",
    { reply_markup: new InlineKeyboard().text("Skip ⏭", "skip_step") },
  );

  const data: CreateMemberInput = {};

  // 1. Bio
  const bioResponse = await conversation.wait();
  if (bioResponse.callbackQuery?.data === "skip_step") {
    await bioResponse.answerCallbackQuery();
  } else if (bioResponse.message?.text) {
    data.bio = bioResponse.message.text.slice(0, 500);
  }

  // 2. Title + Company
  const titleAnswer = await askQuestion(
    conversation,
    bioResponse.callbackQuery ? bioResponse : ctx,
    '2/5 — What do you do? (e.g. "Software Engineer at Grab"):',
  );
  if (titleAnswer) {
    const { title, company } = parseTitleCompany(titleAnswer);
    data.currentTitle = title;
    data.currentCompany = company;
  }

  // 3. Skills
  const skillsAnswer = await askQuestion(
    conversation,
    ctx,
    "3/5 — Your skills? (comma-separated, e.g. TypeScript, React, Python):",
  );
  if (skillsAnswer) {
    data.skills = parseCsvList(skillsAnswer);
  }

  // 4. Interests
  const interestsAnswer = await askQuestion(
    conversation,
    ctx,
    "4/5 — Your interests? (comma-separated, e.g. AI, Web Dev, Open Source):",
  );
  if (interestsAnswer) {
    data.interests = parseCsvList(interestsAnswer);
  }

  // 5. GitHub
  const githubAnswer = await askQuestion(
    conversation,
    ctx,
    "5/5 — Your GitHub username:",
  );
  if (githubAnswer) {
    data.githubHandle = githubAnswer.replace(/^@/, "").trim();
  }

  // Create or update member
  if (existing) {
    await conversation.external(() => membersService.update(userId, data));
  } else {
    await conversation.external(() => membersService.create(userId, data));
  }

  // Build summary
  const verb = existing ? "updated" : "created";
  const lines = [`Your MSOCIETY profile has been ${verb}!\n`];
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

  await ctx.reply(lines.join("\n"));
}

function formatProfile(member: {
  bio?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  skills?: string[] | null;
  interests?: string[] | null;
  githubHandle?: string | null;
}): string {
  const lines: string[] = [];
  if (member.bio) lines.push(`*Bio:* ${member.bio}`);
  if (member.currentTitle) {
    const role = member.currentCompany
      ? `${member.currentTitle} at ${member.currentCompany}`
      : member.currentTitle;
    lines.push(`*Role:* ${role}`);
  }
  if (member.skills?.length) lines.push(`*Skills:* ${member.skills.join(", ")}`);
  if (member.interests?.length) lines.push(`*Interests:* ${member.interests.join(", ")}`);
  if (member.githubHandle) lines.push(`*GitHub:* ${member.githubHandle}`);
  return lines.length > 0 ? lines.join("\n") : "Your profile is empty.";
}

export const profileHandler = new Composer<BotContext>();

profileHandler.use(createConversation(setProfileConversation));

profileHandler.command("profile", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply("Please use this command in a private chat with me.");
    return;
  }

  const from = ctx.from;
  if (!from) return;

  const telegramUser = await telegramUserFromContext(from, ctx.api);
  const userId = await createTelegramUser(telegramUser);
  const member = await membersService.findByUserId(userId);

  if (!member) {
    await ctx.reply("You haven't set up your profile yet.", {
      reply_markup: new InlineKeyboard().text("Edit Profile", "edit_profile"),
    });
    return;
  }

  await ctx.reply(`*Your MSOCIETY Profile*\n\n${formatProfile(member)}`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("Edit Profile", "edit_profile"),
  });
});

profileHandler.callbackQuery("edit_profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("setProfileConversation");
});

profileHandler.command("set_profile", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply("Please use this command in a private chat with me.");
    return;
  }

  await ctx.conversation.enter("setProfileConversation");
});
