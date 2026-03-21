import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import { schemaSDL } from "../../../graphql";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createProjectsAgent(ctx: ToolContext) {
  const projectsTools = {
    graphql_query: tool({
      description:
        "Query community projects via GraphQL. Write a GraphQL query selecting only the fields you need.",
      inputSchema: z.object({
        query: z.string().describe("GraphQL query string"),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("GraphQL variables"),
      }),
      execute: async ({ query, variables }) => {
        console.log("[projects-agent:graphql_query]", query.slice(0, 120));
        return ctx.graphql(query, variables);
      },
    }),

    create_project: tool({
      description: "Create a new community project",
      inputSchema: z.object({
        name: z.string().describe("Project name"),
        description: z.string().optional().describe("Project description"),
        nature: z
          .enum(["startup", "community", "side_project"])
          .describe("Project nature"),
        platforms: z
          .array(z.enum(["web_app", "mobile_app", "mobile_game", "telegram_bot", "library", "other"]))
          .optional()
          .describe("Platforms the project targets"),
        url: z.string().optional().describe("Project URL"),
        repoUrl: z.string().optional().describe("Repository URL"),
      }),
      execute: async ({ name, description, nature, platforms, url, repoUrl }) => {
        console.log("[projects-agent:create_project]", { name, nature });
        const { data, error } = await ctx.api.api.v1.projects.post({
          name, description, nature, platforms: platforms ?? [], url, repoUrl,
        });
        if (error) {
          console.error("[projects-agent:create_project] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    update_project: tool({
      description: "Update an existing project. Only available to project owner or admin.",
      inputSchema: z.object({
        project_id: z.string().describe("The project ID (UUID) or slug"),
        name: z.string().optional().describe("Project name"),
        description: z.string().optional().describe("Project description"),
        nature: z
          .enum(["startup", "community", "side_project"])
          .optional()
          .describe("Project nature"),
        platforms: z
          .array(z.enum(["web_app", "mobile_app", "mobile_game", "telegram_bot", "library", "other"]))
          .optional()
          .describe("Platforms the project targets"),
        url: z.string().optional().describe("Project URL"),
        repoUrl: z.string().optional().describe("Repository URL"),
        status: z
          .enum(["active", "paused", "archived"])
          .optional()
          .describe("Project status"),
      }),
      execute: async ({
        project_id, name, description, nature, platforms, url, repoUrl, status,
      }) => {
        console.log("[projects-agent:update_project]", { project_id, name, status });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .patch({ name, description, nature, platforms, url, repoUrl, status });
        if (error) {
          console.error("[projects-agent:update_project] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    add_project_member: tool({
      description: "Add a member to a project team. Requires project owner or admin.",
      inputSchema: z.object({
        project_id: z.string().describe("The project ID (UUID) or slug"),
        user_id: z.string().describe("The user ID to add"),
        role: z.enum(["owner", "contributor"]).describe("Role in the project"),
      }),
      execute: async ({ project_id, user_id, role }) => {
        console.log("[projects-agent:add_project_member]", { project_id, user_id, role });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .members.post({ userId: user_id, role });
        if (error) {
          console.error("[projects-agent:add_project_member] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    remove_project_member: tool({
      description:
        "Remove a member from a project team. Requires project owner or admin. Cannot remove the last owner.",
      inputSchema: z.object({
        project_id: z.string().describe("The project ID (UUID) or slug"),
        user_id: z.string().describe("The user ID to remove"),
      }),
      execute: async ({ project_id, user_id }) => {
        console.log("[projects-agent:remove_project_member]", { project_id, user_id });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .members({ userId: user_id })
          .delete();
        if (error) {
          console.error("[projects-agent:remove_project_member] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),

    delete_project: tool({
      description: "Delete a project. Only available to admin.",
      inputSchema: z.object({
        project_id: z.string().describe("The project ID (UUID) or slug"),
      }),
      execute: async ({ project_id }) => {
        console.log("[projects-agent:delete_project]", { project_id });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .delete();
        if (error) {
          console.error("[projects-agent:delete_project] error:", error.status, error.value);
          return { status: error.status, value: error.value };
        }
        return data;
      },
    }),
  };

  return async function runProjectsAgent(query: string): Promise<string> {
    console.log("[projects-agent] query:", query);
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: `You are a projects assistant for the MSOCIETY community. Help with listing, viewing, creating, and managing projects and their team members. Only perform write operations (create/update/delete/add member/remove member) when explicitly asked. Never repeat a write. Be concise, format for Telegram Markdown.

Always search by name before attempting updates. Use the graphql_query tool for reads. Paginate when hasNext is true.

## GraphQL Schema

${schemaSDL}`,
      messages: [{ role: "user", content: query }],
      tools: projectsTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[projects-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No project information found.";
  };
}
