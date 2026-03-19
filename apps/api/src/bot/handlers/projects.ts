import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { projectsService } from "../../services/projects.service";

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
