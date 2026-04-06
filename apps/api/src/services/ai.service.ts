import { generateText, generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { db } from "../db";
import { aiUsage } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { env } from "../env";

// ── Model constants ─────────────────────────────────────────

export const AI_MODEL_IDS = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-4-20250514",
} as const;

// ── Provider (single instance) ──────────────────────────────

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

const AI_MODELS: { fast: LanguageModel; smart: LanguageModel } = {
  fast: anthropic(AI_MODEL_IDS.fast),
  smart: anthropic(AI_MODEL_IDS.smart),
};

// ── Pricing ─────────────────────────────────────────────────

/** Price per 1M tokens, in USD. Update when pricing changes. */
const AI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  [AI_MODEL_IDS.fast]: { input: 0.8, output: 4.0 },
  [AI_MODEL_IDS.smart]: { input: 3.0, output: 15.0 },
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ── Usage tracking ──────────────────────────────────────────

export interface TrackingContext {
  caller: string;
  telegramUserId?: number | null;
  chatId?: string | null;
}

interface TrackUsageInput {
  model: string;
  caller: string;
  inputTokens: number;
  outputTokens: number;
  telegramUserId?: number | null;
  chatId?: string | null;
  success: boolean;
  errorMessage?: string | null;
  durationMs?: number | null;
}

interface UsageQueryParams {
  from?: string;
  to?: string;
  caller?: string;
  model?: string;
}

function resolveModelId(model: Parameters<typeof generateText>[0]["model"]): string {
  if (typeof model === "string") return model;
  if ("modelId" in model) return model.modelId;
  return "unknown";
}

// ── Tracked wrappers ────────────────────────────────────────

async function trackedGenerateText(
  params: Parameters<typeof generateText>[0],
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const modelId = resolveModelId(params.model);
  const start = performance.now();

  try {
    const result = await generateText(params);
    const durationMs = Math.round(performance.now() - start);

    trackUsage({
      model: modelId,
      caller: ctx.caller,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
      success: true,
      durationMs,
    }).catch((err) => console.error("[ai-usage] tracking failed:", err));

    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);

    trackUsage({
      model: modelId,
      caller: ctx.caller,
      inputTokens: 0,
      outputTokens: 0,
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs,
    }).catch((err) => console.error("[ai-usage] tracking failed:", err));

    throw error;
  }
}

async function trackedGenerateObject<T extends Parameters<typeof generateObject>[0]>(
  params: T,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateObject>>> {
  const modelId = resolveModelId(params.model);
  const start = performance.now();

  try {
    const result = await generateObject(params);
    const durationMs = Math.round(performance.now() - start);

    trackUsage({
      model: modelId,
      caller: ctx.caller,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
      success: true,
      durationMs,
    }).catch((err) => console.error("[ai-usage] tracking failed:", err));

    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);

    trackUsage({
      model: modelId,
      caller: ctx.caller,
      inputTokens: 0,
      outputTokens: 0,
      telegramUserId: ctx.telegramUserId,
      chatId: ctx.chatId,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs,
    }).catch((err) => console.error("[ai-usage] tracking failed:", err));

    throw error;
  }
}

// ── Usage persistence & analytics ───────────────────────────

async function trackUsage(input: TrackUsageInput): Promise<void> {
  await db.insert(aiUsage).values({
    model: input.model,
    caller: input.caller,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    telegramUserId: input.telegramUserId ?? null,
    chatId: input.chatId ?? null,
    success: input.success,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs ?? null,
  });
}

async function getUsageStats(params: UsageQueryParams) {
  const conditions = [];
  if (params.from) conditions.push(gte(aiUsage.createdAt, new Date(params.from)));
  if (params.to) conditions.push(lte(aiUsage.createdAt, new Date(params.to)));
  if (params.caller) conditions.push(eq(aiUsage.caller, params.caller));
  if (params.model) conditions.push(eq(aiUsage.model, params.model));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [[totals], byCaller, byModel, byDay] = await Promise.all([
    db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        avgDurationMs: sql<number>`coalesce(avg(${aiUsage.durationMs}), 0)::int`,
        errorCount: sql<number>`count(*) filter (where not ${aiUsage.success})::int`,
      })
      .from(aiUsage)
      .where(where),
    db
      .select({
        caller: aiUsage.caller,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(aiUsage.caller)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        model: aiUsage.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(aiUsage.model),
    db
      .select({
        date: sql<string>`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(sql`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`),
  ]);

  const costByModel = byModel.map((row) => ({
    ...row,
    estimatedCost: estimateCost(row.model, row.inputTokens, row.outputTokens),
  }));

  const totalEstimatedCost = costByModel.reduce(
    (acc, m) => acc + m.estimatedCost,
    0,
  );

  return {
    totals: {
      ...totals!,
      totalTokens: totals!.totalInputTokens + totals!.totalOutputTokens,
      estimatedCost: totalEstimatedCost,
    },
    byCaller,
    byModel: costByModel,
    byDay,
  };
}

async function getUsageSummary(since: Date, telegramUserId?: number) {
  const conditions = [
    gte(aiUsage.createdAt, since),
    eq(aiUsage.success, true),
  ];
  if (telegramUserId) {
    conditions.push(eq(aiUsage.telegramUserId, telegramUserId));
  }

  const where = and(...conditions);

  const rows = await db
    .select({
      model: aiUsage.model,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(where)
    .groupBy(aiUsage.model);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const row of rows) {
    totalInput += row.inputTokens;
    totalOutput += row.outputTokens;
    totalCost += estimateCost(row.model, row.inputTokens, row.outputTokens);
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    estimatedCost: totalCost,
  };
}

async function resolveUserByUsername(username: string) {
  const [row] = await db
    .select({
      telegramId: user.telegramId,
      telegramUsername: user.telegramUsername,
    })
    .from(user)
    .where(eq(sql`lower(${user.telegramUsername})`, username.toLowerCase()))
    .limit(1);
  return row ?? null;
}

async function getTopUsersByTokens(since: Date, limit: number) {
  return db
    .select({
      telegramUserId: aiUsage.telegramUserId,
      telegramUsername: user.telegramUsername,
      firstName: user.name,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .innerJoin(
      user,
      eq(sql`${aiUsage.telegramUserId}::text`, user.telegramId),
    )
    .where(
      and(
        gte(aiUsage.createdAt, since),
        eq(aiUsage.success, true),
      ),
    )
    .groupBy(aiUsage.telegramUserId, user.telegramUsername, user.name)
    .orderBy(desc(sql`sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens})`))
    .limit(limit);
}

// ── Public service ──────────────────────────────────────────

export const aiService = {
  models: AI_MODELS,
  modelIds: AI_MODEL_IDS,
  generateText: trackedGenerateText,
  generateObject: trackedGenerateObject,
  trackUsage,
  getUsageStats,
  getUsageSummary,
  getTopUsersByTokens,
  resolveUserByUsername,
};
