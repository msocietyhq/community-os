import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createProjectsAgent(ctx: ToolContext) {
  const projectsTools = {
    list_projects: tool({
      description: "List community projects with optional filters",
      inputSchema: z.object({
        status: z
          .enum(["active", "paused", "archived"])
          .optional()
          .describe("Filter by project status"),
        nature: z
          .enum(["startup", "community", "side_project"])
          .optional()
          .describe("Filter by project nature"),
        page: z
          .number()
          .optional()
          .describe("Page number (default: 1)"),
        limit: z
          .number()
          .optional()
          .describe("Items per page (default: 5)"),
      }),
      execute: async ({ status, nature, page, limit }) => {
        console.log("[projects-agent:list_projects]", { status, nature, page, limit });
        const { data, error } = await ctx.api.api.v1.projects.get({
          query: { status, nature, page: page ?? 1, limit: limit ?? 5 },
        });
        if (error) { console.error("[projects-agent:list_projects] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    get_project: tool({
      description: "Get details of a specific project including members",
      inputSchema: z.object({
        project_id: z.string().describe("The project ID (UUID) or slug"),
      }),
      execute: async ({ project_id }) => {
        console.log("[projects-agent:get_project]", { project_id });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .get();
        if (error) { console.error("[projects-agent:get_project] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
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
          name,
          description,
          nature,
          platforms: platforms ?? [],
          url,
          repoUrl,
        });
        if (error) { console.error("[projects-agent:create_project] error:", error.status, error.value); return { status: error.status, value: error.value }; }
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
        project_id,
        name,
        description,
        nature,
        platforms,
        url,
        repoUrl,
        status,
      }) => {
        console.log("[projects-agent:update_project]", { project_id, name, status });
        const { data, error } = await ctx.api.api.v1
          .projects({ id: project_id })
          .patch({
            name,
            description,
            nature,
            platforms,
            url,
            repoUrl,
            status,
          });
        if (error) { console.error("[projects-agent:update_project] error:", error.status, error.value); return { status: error.status, value: error.value }; }
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
        if (error) { console.error("[projects-agent:add_project_member] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    remove_project_member: tool({
      description: "Remove a member from a project team. Requires project owner or admin. Cannot remove the last owner.",
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
        if (error) { console.error("[projects-agent:remove_project_member] error:", error.status, error.value); return { status: error.status, value: error.value }; }
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
        if (error) { console.error("[projects-agent:delete_project] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),
  };

  return async function runProjectsAgent(query: string): Promise<string> {
    console.log("[projects-agent] query:", query);
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: `You are a projects assistant for the MSOCIETY community. Help with listing, viewing, creating, and managing projects and their team members. Only perform write operations (create/update/delete/add member/remove member) when explicitly asked. Never repeat a write. Be concise, format for Telegram Markdown.`,
      messages: [{ role: "user", content: query }],
      tools: projectsTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[projects-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No project information found.";
  };
}
