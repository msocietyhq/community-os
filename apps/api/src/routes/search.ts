import { Elysia } from "elysia";
import { authMiddleware } from "../middleware/auth";
import { searchModel } from "./models/search";
import { searchMessagesHybrid } from "../services/messages.service";
import { recallMemories } from "../services/memory.service";
import { env } from "../env";

export const searchRoutes = new Elysia({ prefix: "/api/v1/search" })
  .use(authMiddleware)
  .use(searchModel)
  .get(
    "/",
    async ({ query: { q, type, limit } }) => {
      const chatId = env.TELEGRAM_GROUP_ID;

      if (!chatId) {
        return { messages: [], memories: [] };
      }

      const shouldSearchMessages = type === "all" || type === "messages";
      const shouldSearchMemories = type === "all" || type === "memories";

      const [messages, memories] = await Promise.all([
        shouldSearchMessages
          ? searchMessagesHybrid(chatId, q, limit)
          : Promise.resolve([]),
        shouldSearchMemories
          ? recallMemories(q, { limit, minSimilarity: 0.5 })
          : Promise.resolve([]),
      ]);

      return { messages, memories };
    },
    {
      auth: true,
      query: "search.query",
      detail: {
        tags: ["Search"],
        summary: "Search messages and memories",
      },
    },
  );
