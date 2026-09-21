import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { DATASET_CATEGORIES } from "@community-os/shared/constants";
import type { ToolContext } from "../tools";
import {
  trackToolCalls,
  type SubagentActivity,
} from "../../lib/subagent-progress";
import { aiService } from "../../../services/ai.service";

export function createDatasetsTools(ctx: ToolContext) {
  return {
    list_datasets: tool({
      description: "List open datasets in the SG Muslim Datasets directory.",
      inputSchema: z.object({
        category: z
          .enum(DATASET_CATEGORIES)
          .optional()
          .describe("Filter by category"),
      }),
      execute: async ({ category }) => {
        console.log("[datasets-agent:list_datasets]", { category });
        const { data, error } = await ctx.api.api.v1.datasets.get({
          query: category ? { category } : {},
        });
        if (error) {
          console.error(
            "[datasets-agent:list_datasets] error:",
            error.status,
            error.value,
          );
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    create_dataset: tool({
      description:
        "Add a new dataset to the directory. Only available to admins.",
      inputSchema: z.object({
        title: z.string().describe("Dataset title"),
        description: z.string().describe("What the dataset contains"),
        source: z.string().describe("Who publishes/maintains the data"),
        link: z.string().describe("URL to the dataset"),
        category: z.enum(DATASET_CATEGORIES).describe("Dataset category"),
        formats: z
          .array(z.string())
          .optional()
          .describe("File formats, e.g. CSV, JSON"),
        license: z.string().optional().describe("License, e.g. CC BY 4.0"),
        coverage: z
          .string()
          .optional()
          .describe("Geographic/time coverage, e.g. 'Singapore'"),
        tags: z.array(z.string()).optional().describe("Search tags"),
        repo_url: z.string().optional().describe("Source repository URL"),
      }),
      execute: async ({
        title,
        description,
        source,
        link,
        category,
        formats,
        license,
        coverage,
        tags,
        repo_url,
      }) => {
        console.log("[datasets-agent:create_dataset]", { title, category });
        const { data, error } = await ctx.api.api.v1.datasets.post({
          title,
          description,
          source,
          link,
          category,
          formats: formats ?? [],
          license,
          coverage,
          tags: tags ?? [],
          repoUrl: repo_url,
        });
        if (error) {
          console.error(
            "[datasets-agent:create_dataset] error:",
            error.status,
            error.value,
          );
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    update_dataset: tool({
      description: "Update an existing dataset. Only available to admins.",
      inputSchema: z.object({
        dataset_id: z.string().describe("The dataset ID"),
        title: z.string().optional().describe("Dataset title"),
        description: z
          .string()
          .optional()
          .describe("What the dataset contains"),
        source: z
          .string()
          .optional()
          .describe("Who publishes/maintains the data"),
        link: z.string().optional().describe("URL to the dataset"),
        category: z
          .enum(DATASET_CATEGORIES)
          .optional()
          .describe("Dataset category"),
        formats: z
          .array(z.string())
          .optional()
          .describe("File formats, e.g. CSV, JSON"),
        license: z.string().optional().describe("License, e.g. CC BY 4.0"),
        coverage: z
          .string()
          .optional()
          .describe("Geographic/time coverage, e.g. 'Singapore'"),
        tags: z.array(z.string()).optional().describe("Search tags"),
        repo_url: z.string().optional().describe("Source repository URL"),
      }),
      execute: async ({
        dataset_id,
        title,
        description,
        source,
        link,
        category,
        formats,
        license,
        coverage,
        tags,
        repo_url,
      }) => {
        console.log("[datasets-agent:update_dataset]", { dataset_id, title });
        const { data, error } = await ctx.api.api.v1
          .datasets({ id: dataset_id })
          .patch({
            title,
            description,
            source,
            link,
            category,
            formats,
            license,
            coverage,
            tags,
            repoUrl: repo_url,
          });
        if (error) {
          console.error(
            "[datasets-agent:update_dataset] error:",
            error.status,
            error.value,
          );
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    delete_dataset: tool({
      description:
        "Delete a dataset from the directory. Only available to admins.",
      inputSchema: z.object({
        dataset_id: z.string().describe("The dataset ID"),
      }),
      execute: async ({ dataset_id }) => {
        console.log("[datasets-agent:delete_dataset]", { dataset_id });
        const { data, error } = await ctx.api.api.v1
          .datasets({ id: dataset_id })
          .delete();
        if (error) {
          console.error(
            "[datasets-agent:delete_dataset] error:",
            error.status,
            error.value,
          );
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),
  };
}

/** Every tool this sub-agent can call. Drives the label map's exhaustiveness. */
export type DatasetsToolName = keyof ReturnType<typeof createDatasetsTools>;

export function createDatasetsAgent(ctx: ToolContext) {
  const datasetsTools = createDatasetsTools(ctx);

  return async function runDatasetsAgent(
    query: string,
    activity?: SubagentActivity,
  ): Promise<string> {
    console.log("[datasets-agent] query:", query);
    const result = await aiService.generateText(
      {
        system: `You are a datasets assistant for the MSOCIETY community. Help with listing, viewing, creating, updating, and deleting entries in the SG Muslim Datasets directory (open data about Singapore's Muslim community). Only perform write operations (create/update/delete) when explicitly asked, and only real, verifiable sources — never invent a dataset's link. Be concise, format for Telegram Markdown.`,
        messages: [{ role: "user", content: query }],
        tools: trackToolCalls(datasetsTools, activity),
        stopWhen: stepCountIs(5),
        maxOutputTokens: 512,
      },
      {
        caller: "datasets-agent",
        tier: "fast",
        telegramUserId: ctx.senderTelegramId,
        chatId: ctx.chatId,
      },
    );

    console.log(
      "[datasets-agent] steps:",
      result.steps.length,
      "| response:",
      result.text?.slice(0, 120),
    );
    return result.text || "No dataset information found.";
  };
}
