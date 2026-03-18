import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, BotConversation } from "../types";
import { createTelegramUser } from "../lib/auth";
import { telegramUserFromContext } from "../lib/telegram-user";
import { membersService } from "../../services/members.service";
import { reputationService } from "../../services/reputation.service";
import type {
  CreateMemberInput,
  UpdateMemberInput,
} from "@community-os/shared/validators";
import { env } from "../../env";
import { bot } from "../bot";

function parseCsvList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function withCurrent(prompt: string, value: string | null | undefined): string {
  if (!value) return prompt;
  return `${prompt}\n\n\`${value}\``;
}

async function askQuestion(
  conversation: BotConversation,
  ctx: BotContext,
  prompt: string,
): Promise<string | null> {
  const keyboard = new InlineKeyboard().text("Skip ⏭", "skip_step");
  await ctx.reply(prompt, { reply_markup: keyboard, parse_mode: "Markdown" });
  const response = await conversation.wait();
  if (response.callbackQuery?.data === "skip_step") {
    await response.answerCallbackQuery();
    await response.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    return null;
  }
  return response.message?.text ?? null;
}

async function setProfileConversation(
  conversation: BotConversation,
  ctx: BotContext,
) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  // Verify user is a member of the MSOCIETY Telegram group
  if (env.TELEGRAM_GROUP_ID) {
    const member = await conversation.external(async () => {
      try {
        return await bot.api.getChatMember(env.TELEGRAM_GROUP_ID!, from.id);
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
    telegramUserFromContext(from, bot.api),
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
      "Press Skip to skip any question.",
  );

  const data: UpdateMemberInput = {};

  // 1. Bio
  const bioAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent("1/7 — Tell us about yourself (max 500 chars):", existing?.bio),
  );
  if (bioAnswer) {
    data.bio = bioAnswer.slice(0, 500);
  }

  // 2. Title
  const titleAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent(
      '2/7 — What\'s your role? (e.g. "Software Engineer"):',
      existing?.currentTitle,
    ),
  );
  if (titleAnswer) {
    data.currentTitle = titleAnswer.trim();
  }

  // 3. Company
  const companyAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent(
      '3/7 — Where do you work? (e.g. "Grab"):',
      existing?.currentCompany,
    ),
  );
  if (companyAnswer) {
    data.currentCompany = companyAnswer.trim();
  }

  // 4. Skills
  const skillsAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent(
      "4/7 — Your skills? (comma-separated, e.g. TypeScript, React, Python):",
      existing?.skills?.join(", "),
    ),
  );
  if (skillsAnswer) {
    data.skills = parseCsvList(skillsAnswer);
  }

  // 5. Interests
  const interestsAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent(
      "5/7 — Your interests? (comma-separated, e.g. AI, Web Dev, Open Source):",
      existing?.interests?.join(", "),
    ),
  );
  if (interestsAnswer) {
    data.interests = parseCsvList(interestsAnswer);
  }

  // 6. GitHub
  const githubAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent("6/7 — Your GitHub username:", existing?.githubHandle),
  );
  if (githubAnswer) {
    data.githubHandle = githubAnswer.replace(/^@/, "").trim();
  }

  // 7. LinkedIn
  const linkedinAnswer = await askQuestion(
    conversation,
    ctx,
    withCurrent("7/7 — Your LinkedIn username or URL:", existing?.linkedinUrl),
  );
  if (linkedinAnswer) {
    const raw = linkedinAnswer.trim().replace(/^@/, "");
    data.linkedinUrl = raw.startsWith("http") ? raw : `https://linkedin.com/in/${raw}`;
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
  if (data.currentTitle) lines.push(`Role: ${data.currentTitle}`);
  if (data.currentCompany) lines.push(`Company: ${data.currentCompany}`);
  if (data.skills?.length) lines.push(`Skills: ${data.skills.join(", ")}`);
  if (data.interests?.length)
    lines.push(`Interests: ${data.interests.join(", ")}`);
  if (data.githubHandle) lines.push(`GitHub: ${data.githubHandle}`);
  if (data.linkedinUrl) lines.push(`LinkedIn: ${data.linkedinUrl}`);

  await ctx.reply(lines.join("\n"));
}

function hasProfileData(member: {
  bio?: string | null;
  currentTitle?: string | null;
  skills?: string[] | null;
  interests?: string[] | null;
  githubHandle?: string | null;
  linkedinUrl?: string | null;
}): boolean {
  return !!(
    member.bio ||
    member.currentTitle ||
    (member.skills && member.skills.length > 0) ||
    (member.interests && member.interests.length > 0) ||
    member.githubHandle ||
    member.linkedinUrl
  );
}

function esc(text: string): string {
  return text.replace(/[_*`[\]]/g, "\\$&");
}

function formatProfile(
  name: string,
  username: string | null | undefined,
  score: number,
  member: {
    bio?: string | null;
    currentTitle?: string | null;
    currentCompany?: string | null;
    skills?: string[] | null;
    interests?: string[] | null;
    githubHandle?: string | null;
    linkedinUrl?: string | null;
  },
): string {
  const header = `*${esc(name)}*` + (username ? ` (@${esc(username)})` : "");

  const titleCompany = [member.currentTitle, member.currentCompany]
    .filter(Boolean)
    .join(" at ");

  const sections: string[] = [header];

  if (titleCompany) sections.push(esc(titleCompany));
  sections.push(`⭐ ${score} pts`);

  if (member.bio) {
    sections.push("");
    sections.push(esc(member.bio));
  }

  const tags: string[] = [];
  if (member.skills?.length)
    tags.push(`🌱 ${member.skills.map(esc).join(" · ")}`);
  if (member.interests?.length)
    tags.push(`✨ ${member.interests.map(esc).join(" · ")}`);
  if (tags.length) {
    sections.push("");
    sections.push(...tags);
  }

  const links: string[] = [];
  if (member.githubHandle) links.push(`github.com/${esc(member.githubHandle)}`);
  if (member.linkedinUrl) links.push(member.linkedinUrl);
  if (links.length) {
    sections.push("");
    sections.push(...links);
  }

  return sections.join("\n");
}

const fieldConfig = {
  bio: { label: "Bio", prompt: "Tell us about yourself (max 500 chars):" },
  title: {
    label: "Role",
    prompt: 'What\'s your role? (e.g. "Software Engineer"):',
  },
  company: { label: "Company", prompt: 'Where do you work? (e.g. "Grab"):' },
  skills: {
    label: "Skills",
    prompt: "Your skills? (comma-separated, e.g. TypeScript, React, Python):",
  },
  interests: {
    label: "Interests",
    prompt: "Your interests? (comma-separated, e.g. AI, Web Dev, Open Source):",
  },
  github: { label: "GitHub", prompt: "Your GitHub username:" },
  linkedin: { label: "LinkedIn", prompt: "Your LinkedIn username or URL:" },
} as const;

type EditableField = keyof typeof fieldConfig;

function currentValueForField(
  member: NonNullable<Awaited<ReturnType<typeof membersService.findByUserId>>>,
  field: EditableField,
): string | null | undefined {
  switch (field) {
    case "bio":
      return member.bio;
    case "title":
      return member.currentTitle;
    case "company":
      return member.currentCompany;
    case "skills":
      return member.skills?.join(", ");
    case "interests":
      return member.interests?.join(", ");
    case "github":
      return member.githubHandle;
    case "linkedin":
      return member.linkedinUrl;
  }
}

function applyFieldUpdate(
  field: EditableField,
  text: string,
): UpdateMemberInput {
  switch (field) {
    case "bio":
      return { bio: text.slice(0, 500) };
    case "title":
      return { currentTitle: text.trim() };
    case "company":
      return { currentCompany: text.trim() };
    case "skills":
      return { skills: parseCsvList(text) };
    case "interests":
      return { interests: parseCsvList(text) };
    case "github":
      return { githubHandle: text.replace(/^@/, "").trim() };
    case "linkedin": {
      const raw = text.trim().replace(/^@/, "");
      const url = raw.startsWith("http") ? raw : `https://linkedin.com/in/${raw}`;
      return { linkedinUrl: url };
    }
  }
}

const editFieldKeyboard = new InlineKeyboard()
  .text("Bio", "edit_field:bio")
  .text("Role", "edit_field:title")
  .text("Company", "edit_field:company")
  .row()
  .text("Skills", "edit_field:skills")
  .text("Interests", "edit_field:interests")
  .text("GitHub", "edit_field:github")
  .row()
  .text("LinkedIn", "edit_field:linkedin")
  .row()
  .text("← Back", "edit_back");

async function editFieldConversation(
  conversation: BotConversation,
  ctx: BotContext,
) {
  const field = ctx.callbackQuery?.data?.replace("edit_field:", "") as
    | EditableField
    | undefined;
  if (!field || !(field in fieldConfig)) return;

  const from = ctx.from;
  if (!from) return;

  const telegramUser = await conversation.external(() =>
    telegramUserFromContext(from, bot.api),
  );
  const userId = await conversation.external(() =>
    createTelegramUser(telegramUser),
  );
  const existing = await conversation.external(() =>
    membersService.findByUserId(userId),
  );

  const config = fieldConfig[field];
  const current = existing ? currentValueForField(existing, field) : undefined;
  const updatePrompt = `What should we update your ${config.label.toLowerCase()} with?`;
  const message = current ? `\`${current}\`\n\n${updatePrompt}` : updatePrompt;

  const cancelKeyboard = new InlineKeyboard().text("Cancel ✕", "cancel_edit");
  await ctx.reply(message, {
    reply_markup: cancelKeyboard,
    parse_mode: "Markdown",
  });
  const response = await conversation.wait();

  if (response.callbackQuery?.data === "cancel_edit") {
    await response.answerCallbackQuery();
    await response.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    return;
  }

  const text = response.message?.text;
  if (!text) {
    await response.reply("No text received. Edit cancelled.");
    return;
  }

  const data = applyFieldUpdate(field, text);
  if (existing) {
    await conversation.external(() => membersService.update(userId, data));
  } else {
    await conversation.external(() => membersService.create(userId, data));
  }

  await response.reply(`${config.label} updated!`);
}

export const profileHandler = new Composer<BotContext>();

profileHandler.use(createConversation(setProfileConversation));
profileHandler.use(createConversation(editFieldConversation));

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

  if (!member || !hasProfileData(member)) {
    await ctx.conversation.enter("setProfileConversation");
    return;
  }

  const score = await reputationService.getScore(userId);
  const displayName = from.first_name + (from.last_name ? ` ${from.last_name}` : "");

  await ctx.reply(formatProfile(displayName, from.username, score, member), {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("Edit Profile", "edit_profile"),
  });
});

profileHandler.callbackQuery("edit_profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: editFieldKeyboard });
});

profileHandler.callbackQuery("edit_back", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard().text("Edit Profile", "edit_profile"),
  });
});

profileHandler.callbackQuery(/^edit_field:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("editFieldConversation");
});
