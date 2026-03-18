import { generateText, stepCountIs, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { env } from "../../../env";
import type { ToolContext } from "../tools";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

export function createVenuesAgent(ctx: ToolContext) {
  const venuesTools = {
    list_venues: tool({
      description: "List community venues/locations for events",
      inputSchema: z.object({
        q: z.string().optional().describe("Search by venue name or address"),
        limit: z
          .number()
          .optional()
          .describe("Number of venues to return (default: 20)"),
      }),
      execute: async ({ q, limit }) => {
        console.log("[venues-agent:list_venues]", { q, limit });
        const { data, error } = await ctx.api.api.v1.venues.get({
          query: { q, page: 1, limit: limit ?? 20 },
        });
        if (error) { console.error("[venues-agent:list_venues] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        console.log("[venues-agent:list_venues] returned", Array.isArray(data) ? data.length : 1, "item(s)");
        return data;
      },
    }),

    create_venue: tool({
      description: "Create a new venue/location. Only available to admins.",
      inputSchema: z.object({
        name: z.string().describe("Venue name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        country: z
          .string()
          .optional()
          .describe("2-letter country code (e.g. 'AE')"),
        postal_code: z.string().optional().describe("Postal/ZIP code"),
        maps_url: z.string().optional().describe("Google Maps or similar URL"),
        capacity: z.number().optional().describe("Maximum capacity"),
        cost_per_day: z
          .number()
          .optional()
          .describe("Cost per day in base currency"),
        cost_notes: z
          .string()
          .optional()
          .describe("Notes about cost (e.g. discounts)"),
        notes: z.string().optional().describe("General notes about the venue"),
      }),
      execute: async ({
        name,
        address,
        city,
        country,
        postal_code,
        maps_url,
        capacity,
        cost_per_day,
        cost_notes,
        notes,
      }) => {
        console.log("[venues-agent:create_venue]", { name, city, country, capacity });
        const { data, error } = await ctx.api.api.v1.venues.post({
          name,
          address,
          city,
          country,
          postalCode: postal_code,
          mapsUrl: maps_url,
          capacity,
          costPerDay: cost_per_day,
          costNotes: cost_notes,
          notes,
        });
        if (error) { console.error("[venues-agent:create_venue] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    update_venue: tool({
      description: "Update an existing venue. Only available to admins.",
      inputSchema: z.object({
        venue_id: z.string().describe("The venue ID"),
        name: z.string().optional().describe("Venue name"),
        address: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        country: z.string().optional().describe("2-letter country code"),
        postal_code: z.string().optional().describe("Postal/ZIP code"),
        maps_url: z.string().optional().describe("Google Maps or similar URL"),
        capacity: z.number().optional().describe("Maximum capacity"),
        cost_per_day: z
          .number()
          .optional()
          .describe("Cost per day in base currency"),
        cost_notes: z.string().optional().describe("Notes about cost"),
        notes: z.string().optional().describe("General notes about the venue"),
      }),
      execute: async ({
        venue_id,
        name,
        address,
        city,
        country,
        postal_code,
        maps_url,
        capacity,
        cost_per_day,
        cost_notes,
        notes,
      }) => {
        console.log("[venues-agent:update_venue]", { venue_id, name, city });
        const { data, error } = await ctx.api.api.v1
          .venues({ id: venue_id })
          .patch({
            name,
            address,
            city,
            country,
            postalCode: postal_code,
            mapsUrl: maps_url,
            capacity,
            costPerDay: cost_per_day,
            costNotes: cost_notes,
            notes,
          });
        if (error) { console.error("[venues-agent:update_venue] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),

    delete_venue: tool({
      description: "Delete a venue. Only available to admins.",
      inputSchema: z.object({
        venue_id: z.string().describe("The venue ID"),
      }),
      execute: async ({ venue_id }) => {
        console.log("[venues-agent:delete_venue]", { venue_id });
        const { data, error } = await ctx.api.api.v1
          .venues({ id: venue_id })
          .delete();
        if (error) { console.error("[venues-agent:delete_venue] error:", error.status, error.value); return { status: error.status, value: error.value }; }
        return data;
      },
    }),
  };

  return async function runVenuesAgent(query: string): Promise<string> {
    console.log("[venues-agent] query:", query);
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: `You are a venues assistant for the MSOCIETY community. Help with listing, creating, updating, and deleting community venues. Only perform write operations when explicitly asked. Be concise, format for Telegram Markdown.`,
      messages: [{ role: "user", content: query }],
      tools: venuesTools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 512,
    });

    console.log("[venues-agent] steps:", result.steps.length, "| response:", result.text?.slice(0, 120));
    return result.text || "No venue information found.";
  };
}
