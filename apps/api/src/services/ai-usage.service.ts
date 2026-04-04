import { db } from "../db";
import { aiUsage } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { estimateCost } from "../bot/lib/ai-pricing";

export interface TrackUsageInput {
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

export const aiUsageService = {
  async trackUsage(input: TrackUsageInput): Promise<void> {
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
  },

  async getUsageStats(params: UsageQueryParams) {
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
  },

  async getTopUsersByTokens(since: Date, limit: number) {
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
  },
};
