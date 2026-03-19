import { Composer, InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, BotConversation } from "../types";
import { resolveUser } from "../lib/auth";
import { projectsService } from "../../services/projects.service";
import {
  PROJECT_NATURES,
  PROJECT_PLATFORMS,
} from "@community-os/shared/constants";
import type { CreateProjectInput } from "@community-os/shared/validators";

export const projectsHandler = new Composer<BotContext>();

const PAGE_SIZE = 5;

function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[\]]/g, "\\$&");
}

const natureLabels: Record<string, string> = {
  startup: "🚀 startup",
  community: "🤝 community",
  side_project: "🔧 side\\_project",
};

const statusLabels: Record<string, string> = {
  active: "🟢 active",
  paused: "⏸ paused",
  archived: "📦 archived",
};

async function buildProjectsMessage(page: number) {
  const { projects, total } = await projectsService.list({
    page,
    limit: PAGE_SIZE,
  });
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (projects.length === 0 && page === 1) {
    return {
      text: "🚀 *Community Projects*\n\nNo projects yet. Be the first to add one!",
      keyboard: undefined,
    };
  }

  const lines = [`🚀 *Community Projects* (page ${page}/${totalPages})\n`];

  for (const [i, p] of projects.entries()) {
    const num = (page - 1) * PAGE_SIZE + i + 1;
    const endorsed = p.isEndorsed ? " 🏅" : "";
    const nature = natureLabels[p.nature] ?? p.nature;
    const status = statusLabels[p.status ?? "active"] ?? p.status;

    lines.push(
      `*${num}. ${escapeMarkdown(p.name)}*${endorsed}`,
      `${nature} · ${status}`,
      `👥 ${p.memberCount} member${p.memberCount === 1 ? "" : "s"}`,
      "",
    );
  }

  const keyboard = new InlineKeyboard();
  if (page > 1) keyboard.text("« Prev", `projects_page:${page - 1}`);
  if (page < totalPages) keyboard.text("Next »", `projects_page:${page + 1}`);

  return {
    text: lines.join("\n"),
    keyboard: keyboard.inline_keyboard.length > 0 ? keyboard : undefined,
  };
}

const natureEmojis: Record<string, string> = {
  startup: "🚀",
  community: "🤝",
  side_project: "🔧",
};

const platformLabels: Record<string, string> = {
  web_app: "🌐 Web App",
  mobile_app: "📱 Mobile App",
  mobile_game: "🎮 Mobile Game",
  telegram_bot: "🤖 Telegram Bot",
  library: "📚 Library",
  other: "🔧 Other",
};

async function createProjectConversation(
  conversation: BotConversation,
  ctx: BotContext,
) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  const resolved = await conversation.external(() =>
    resolveUser(String(from.id)),
  );
  if (!resolved) {
    await ctx.reply(
      "You need to set up your profile first. Send /profile to get started.",
    );
    return;
  }

  const userId = resolved.user.id;

  await ctx.reply(
    "Let's submit a new project! I'll ask you a few questions.\n" +
      "Press Skip to skip optional fields.",
  );

  // 1/5 — Name (required)
  await ctx.reply("1/5 — What's the name of your project?");
  let nameResponse = await conversation.wait();
  while (!nameResponse.message?.text) {
    await ctx.reply("Please type a project name.");
    nameResponse = await conversation.wait();
  }
  const name = nameResponse.message.text.trim().slice(0, 100);

  // 2/5 — Description (optional)
  const skipKeyboard = new InlineKeyboard().text("Skip ⏭", "cp_skip");
  await ctx.reply("2/5 — Describe your project (or skip):", {
    reply_markup: skipKeyboard,
  });
  const descResponse = await conversation.wait();
  let description: string | undefined;
  if (descResponse.callbackQuery?.data === "cp_skip") {
    await descResponse.answerCallbackQuery();
    await descResponse.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  } else if (descResponse.message?.text) {
    description = descResponse.message.text.trim();
  }

  // 3/5 — Nature (required, single-select)
  const natureKeyboard = new InlineKeyboard();
  for (const n of PROJECT_NATURES) {
    natureKeyboard.text(
      `${natureEmojis[n] ?? ""} ${n.replace("_", " ")}`,
      `cp_nature:${n}`,
    );
  }
  await ctx.reply("3/5 — What type of project is this?", {
    reply_markup: natureKeyboard,
  });
  let natureResponse = await conversation.wait();
  while (!natureResponse.callbackQuery?.data?.startsWith("cp_nature:")) {
    await ctx.reply("Please tap one of the buttons above.");
    natureResponse = await conversation.wait();
  }
  const nature = natureResponse.callbackQuery.data.replace(
    "cp_nature:",
    "",
  ) as (typeof PROJECT_NATURES)[number];
  await natureResponse.answerCallbackQuery();
  await natureResponse.editMessageReplyMarkup({
    reply_markup: { inline_keyboard: [] },
  });

  // 4/5 — Platforms (optional, multi-select)
  const selectedPlatforms = new Set<string>();

  function buildPlatformKeyboard() {
    const kb = new InlineKeyboard();
    const entries = [...PROJECT_PLATFORMS];
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i]!;
      const label = selectedPlatforms.has(p)
        ? `✓ ${platformLabels[p] ?? p}`
        : (platformLabels[p] ?? p);
      kb.text(label, `cp_platform:${p}`);
      if (i % 2 === 1) kb.row();
    }
    kb.row().text("✅ Done", "cp_done").text("Skip ⏭", "cp_skip");
    return kb;
  }

  await ctx.reply("4/5 — Which platforms? (tap to toggle, then Done)", {
    reply_markup: buildPlatformKeyboard(),
  });

  let platformsDone = false;
  while (!platformsDone) {
    const pResponse = await conversation.wait();
    const cbData = pResponse.callbackQuery?.data;
    if (!cbData) continue;

    if (cbData === "cp_done" || cbData === "cp_skip") {
      await pResponse.answerCallbackQuery();
      await pResponse.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: [] },
      });
      if (cbData === "cp_skip") selectedPlatforms.clear();
      platformsDone = true;
    } else if (cbData.startsWith("cp_platform:")) {
      const platform = cbData.replace("cp_platform:", "");
      if (selectedPlatforms.has(platform)) {
        selectedPlatforms.delete(platform);
      } else {
        selectedPlatforms.add(platform);
      }
      await pResponse.answerCallbackQuery();
      await pResponse.editMessageReplyMarkup({
        reply_markup: buildPlatformKeyboard(),
      });
    }
  }

  // 5/5 — URL (optional)
  await ctx.reply("5/5 — Project URL? (or skip)", {
    reply_markup: new InlineKeyboard().text("Skip ⏭", "cp_skip"),
  });
  const urlResponse = await conversation.wait();
  let url: string | undefined;
  if (urlResponse.callbackQuery?.data === "cp_skip") {
    await urlResponse.answerCallbackQuery();
    await urlResponse.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  } else if (urlResponse.message?.text) {
    url = urlResponse.message.text.trim();
  }

  // Create the project
  const input: CreateProjectInput = {
    name,
    description,
    nature,
    platforms: [...selectedPlatforms] as CreateProjectInput["platforms"],
    url,
  };

  const project = await conversation.external(() =>
    projectsService.create(input, userId),
  );

  const lines = [
    `✅ Project created!\n`,
    `*${escapeMarkdown(project.name)}*`,
    `${natureEmojis[project.nature] ?? ""} ${project.nature.replace("_", " ")}`,
  ];
  if (project.description) lines.push(`\n${escapeMarkdown(project.description)}`);
  if (project.platforms?.length) {
    lines.push(
      `\nPlatforms: ${project.platforms.map((p) => platformLabels[p] ?? p).join(", ")}`,
    );
  }
  if (project.url) lines.push(`\nURL: ${project.url}`);

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

projectsHandler.use(createConversation(createProjectConversation));

projectsHandler.command("create_project", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply("Please use this command in a private chat with me.");
    return;
  }
  await ctx.conversation.enter("createProjectConversation");
});

projectsHandler.command("projects", async (ctx) => {
  const { text, keyboard } = await buildProjectsMessage(1);
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

projectsHandler.callbackQuery(/^projects_page:(\d+)$/, async (ctx) => {
  const page = Number(ctx.match[1]);
  const { text, keyboard } = await buildProjectsMessage(page);
  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
  await ctx.answerCallbackQuery();
});
