import { generateText, generateObject } from "ai";
import { db } from "../db";
import { aiUsage } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import { sql, eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { isPaused } from "@community-os/shared/bot-settings";
import {
  AI_CATALOG,
  AI_TIERS,
  DEFAULT_TIER_MODELS,
  isConfigurableTier,
  type AiModelKey,
  type AiProvider,
  type AiTier,
  type ModelDef,
} from "@community-os/shared/ai-catalog";
import {
  AiBudgetError,
  decideBudget,
  type CallClass,
} from "../bot/lib/ai-budget";
import { getSettings } from "./bot-settings.service";
import { addSpend, getSpend, shouldAlert } from "./ai-spend-counter";
import { estimateCost } from "./ai-pricing";
import { cacheSplit, withPromptCaching } from "./ai-cache";
import { hasCredentials, modelFor } from "./ai-provider";
import { resolveModelKey } from "./model-resolution";
import { classifyProviderError } from "./ai-provider-errors";
import {
  downProviders,
  markHealthy,
  markOutOfCredit,
} from "./provider-health.service";

// ── Tier resolution ─────────────────────────────────────────

/**
 * The SDK's parameter types are intersections over a union of prompt shapes,
 * so TypeScript cannot prove that spreading an `Omit<…, "model">` back
 * together with a model reconstructs the original union member. The two
 * aliases below name that round trip; the casts at the two call sites are
 * re-adding exactly the field the signature removed.
 */
type TextParams = Parameters<typeof generateText>[0];
type ObjectParams = Parameters<typeof generateObject>[0];

interface ResolvedTier {
  /** The catalog key. This is what gets written to `ai_usage.model`. */
  key: AiModelKey;
  def: ModelDef;
  model: ReturnType<typeof modelFor>;
}

/** What a tier currently selects — settings for the configurable ones. */
async function selectedModelKey(tier: AiTier): Promise<AiModelKey> {
  if (!isConfigurableTier(tier)) return DEFAULT_TIER_MODELS[tier];
  return (await getSettings())[`ai.model.${tier}`];
}

/**
 * The model a tier will use.
 *
 * Read per call rather than bound at import, so a settings change applies to
 * the next message without a redeploy — and pinned for the whole of one
 * `generateText`, so a change can never land between two steps of a tool loop.
 * `getSettings` and the provider-health snapshot are both memoised in-process
 * with a 30s TTL, so this is two map lookups.
 *
 * "Usable" is two conditions: the model's API key is present, and its provider
 * has not run out of credit. Both fall through the same `TIER_FALLBACK_ORDER`,
 * so a missing key and an empty balance behave identically — the second was
 * added by extending the first rather than sitting beside it.
 *
 * The stored `ai.model.<tier>` setting is never rewritten. While a provider is
 * down the tier merely resolves elsewhere, so recovery restores the admin's
 * original choice with nothing to undo.
 */
async function pickModelKey(tier: AiTier): Promise<AiModelKey> {
  const selected = await selectedModelKey(tier);
  const down = await downProviders();

  const resolved = resolveModelKey({
    tier,
    selected,
    isUsable: (key) =>
      hasCredentials(key) && !down.has(AI_CATALOG[key].provider),
  });

  if (resolved === null) {
    throw new Error(
      `[ai] no usable model for tier ${tier}: every provider is either ` +
        `unconfigured or out of credit`,
    );
  }

  return resolved;
}

async function resolveTier(tier: AiTier): Promise<ResolvedTier> {
  const key = await pickModelKey(tier);
  const selected = await selectedModelKey(tier);

  if (key !== selected) {
    console.warn(
      `[ai] ${tier} is set to ${selected} but it is unusable ` +
        `(no ${AI_CATALOG[selected].envKey}, or out of credit) — ` +
        `running on ${key}`,
    );
  }

  return { key, def: AI_CATALOG[key], model: modelFor(key) };
}

/**
 * Which model a tier currently resolves to, without instantiating a provider.
 *
 * Exists so a caller can tell the model what it is running on. The agent has
 * no introspection — nothing in a request reveals which model is serving it —
 * so without this it answers "what model are you?" by reading the settings
 * table and guessing, which is how it came to confidently report the wrong
 * model and the wrong tier.
 *
 * Shares `pickModelKey` with `resolveTier`, so the prompt cannot claim one
 * model while the call runs on another.
 */
export async function currentModelFor(
  tier: AiTier,
): Promise<{ key: AiModelKey; label: string }> {
  const key = await pickModelKey(tier);
  return { key, label: AI_CATALOG[key].label };
}

/** Reports which tiers are pointed at a model this deployment cannot run. */
export async function unusableTiers(): Promise<
  { tier: AiTier; key: AiModelKey; envKey: string }[]
> {
  const settings = await getSettings();
  const out: { tier: AiTier; key: AiModelKey; envKey: string }[] = [];

  for (const tier of AI_TIERS) {
    const key = isConfigurableTier(tier)
      ? settings[`ai.model.${tier}`]
      : DEFAULT_TIER_MODELS[tier];
    if (!hasCredentials(key)) {
      out.push({ tier, key, envKey: AI_CATALOG[key].envKey });
    }
  }
  return out;
}

// ── Usage tracking ──────────────────────────────────────────

export interface TrackingContext {
  caller: string;
  /** Which tier to run on. Resolved to a concrete model once per call. */
  tier: AiTier;
  /**
   * Reasoning effort, translated per model by the catalog. Ignored by a model
   * with no effort knob — every provider names it differently, so the caller
   * should not have to know which one it is talking to.
   */
  reasoning?: "medium" | "high";
  telegramUserId?: number | null;
  chatId?: string | null;
  /**
   * Interactive calls answer a member who is waiting; background calls are
   * crons and extraction jobs. The background pause only stops the latter.
   * Defaults to "interactive" — the safer assumption, since wrongly treating a
   * member's question as background would silently drop their answer.
   */
  class?: CallClass;
}

interface TrackUsageInput {
  model: string;
  caller: string;
  /** The whole prompt. The two cache counts below are slices of this. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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

// ── Tracked wrappers ────────────────────────────────────────

/**
 * The single choke point for the background pause and every cost cap.
 *
 * Every AI call in the codebase already funnels through this module, so gating
 * here covers the crons, the memory extractor, the profile sweep and the chat
 * agent at once — instead of a check in each, which would rot.
 */
async function assertWithinBudget(ctx: TrackingContext): Promise<void> {
  const now = new Date();
  const settings = await getSettings();
  const spend = await getSpend(now, estimateCost);

  const verdict = decideBudget({
    callClass: ctx.class ?? "interactive",
    backgroundPaused: isPaused(settings["ai.background"], now),
    spentTodayUsd: spend.todayUsd,
    spentMonthUsd: spend.monthUsd,
    dailyCapUsd: settings["cost.dailyCapUsd"],
    monthlyCapUsd: settings["cost.monthlyCapUsd"],
  });

  if (!verdict.allowed) {
    console.warn(`[ai-budget] blocked ${ctx.caller}: ${verdict.reason}`);
    throw new AiBudgetError(verdict.reason);
  }

  const threshold = settings["cost.alertThresholdUsd"];
  if (shouldAlert(now, threshold, spend.todayUsd)) {
    // Dynamic import keeps the service layer free of a static bot dependency.
    // Fire-and-forget: a failed alert must never block a member's answer.
    import("../bot/lib/spend-alert")
      .then((m) => m.notifyAdminsOfSpend(spend.todayUsd, threshold ?? 0))
      .catch((err) => console.error("[ai-budget] spend alert failed:", err));
  }
}

/** Records a completed call against the in-process running total. */
function recordSpend(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): void {
  addSpend(
    estimateCost(
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    ),
  );
}

/**
 * Runs one AI call, and on credit exhaustion runs it once more on whatever the
 * tier resolves to after the dead provider is marked down.
 *
 * One retry, not a loop: the second resolution already skips every provider
 * known to be down, so a second credit failure means the substitute is empty
 * too. That is rare enough to fail loudly rather than cascade.
 *
 * A successful call clears any outage on its provider, which is how a probe
 * after the backoff window turns into recovery.
 */
async function withCreditFailover<R>(
  tier: AiTier,
  attempt: (resolved: ResolvedTier) => Promise<R>,
): Promise<R> {
  const first = await resolveTier(tier);

  try {
    const result = await attempt(first);
    await onCallSucceeded(first.def.provider);
    return result;
  } catch (error) {
    if (classifyProviderError(error) !== "out_of_credit") throw error;

    const outage = await markOutOfCredit(first.def.provider);
    console.warn(
      `[ai] ${first.def.provider} is out of credit (failure ` +
        `#${outage.failureCount}, next probe ${outage.retryAfter.toISOString()})`,
    );

    if (outage.firstTransition) notifyOutage(first.def.provider, tier);

    const second = await resolveTier(tier);
    if (second.key === first.key) throw error;

    console.warn(`[ai] retrying ${tier} on ${second.key}`);
    const result = await attempt(second);
    await onCallSucceeded(second.def.provider);
    return result;
  }
}

/** Recovery bookkeeping, plus the one DM that says a provider is back. */
async function onCallSucceeded(provider: AiProvider): Promise<void> {
  const recovered = await markHealthy(provider).catch((err) => {
    console.error("[ai] markHealthy failed:", err);
    return false;
  });
  if (!recovered) return;

  // Dynamic import keeps the service layer free of a static bot dependency,
  // matching the spend-alert call in assertWithinBudget.
  import("../bot/lib/provider-alert")
    .then((m) => m.notifyAdminsOfProviderRecovery(provider))
    .catch((err) => console.error("[ai] recovery alert failed:", err));
}

/** Fire-and-forget: a failed DM must never block a member's answer. */
function notifyOutage(provider: AiProvider, tier: AiTier): void {
  import("../bot/lib/provider-alert")
    .then((m) => m.notifyAdminsOfProviderOutage(provider, tier))
    .catch((err) => console.error("[ai] outage alert failed:", err));
}

async function trackedGenerateText(
  params: Omit<Parameters<typeof generateText>[0], "model">,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  await assertWithinBudget(ctx);

  return withCreditFailover(ctx.tier, async ({ key: modelId, def, model }) => {
    const start = performance.now();

    try {
      // The caller's own providerOptions land second, so an explicit setting
      // still wins over the catalog's default fragment.
      const withReasoning =
        ctx.reasoning && def.reasoning
          ? {
              ...params,
              providerOptions: {
                ...def.reasoning[ctx.reasoning],
                ...params.providerOptions,
              },
            }
          : params;

      const result = await generateText(
        withPromptCaching({ ...withReasoning, model } as TextParams, def),
      );
      const durationMs = Math.round(performance.now() - start);
      const { cacheReadTokens, cacheWriteTokens } = cacheSplit(result.usage);

      recordSpend(
        modelId,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
      );

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
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
  });
}

async function trackedGenerateObject<
  T extends Omit<Parameters<typeof generateObject>[0], "model">,
>(
  params: T,
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateObject>>> {
  await assertWithinBudget(ctx);

  return withCreditFailover(ctx.tier, async ({ key: modelId, model }) => {
    const start = performance.now();

    try {
      // Deliberately not cached: a structured-output call is one-shot by
      // construction, so a cache write here could never be read back.
      const result = await generateObject({ ...params, model } as ObjectParams);
      const durationMs = Math.round(performance.now() - start);
      const { cacheReadTokens, cacheWriteTokens } = cacheSplit(result.usage);

      recordSpend(
        modelId,
        result.usage.inputTokens ?? 0,
        result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
      );

      trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
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
  });
}

// ── Usage persistence & analytics ───────────────────────────

async function trackUsage(input: TrackUsageInput): Promise<void> {
  await db.insert(aiUsage).values({
    model: input.model,
    caller: input.caller,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
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
        totalCacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
        totalCacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
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
        cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
        cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
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
        cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
        cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
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
    estimatedCost: estimateCost(
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
    ),
  }));

  const totalEstimatedCost = costByModel.reduce(
    (acc, m) => acc + m.estimatedCost,
    0,
  );

  return {
    totals: {
      ...totals!,
      totalTokens: totals!.totalInputTokens + totals!.totalOutputTokens,
      /**
       * Share of prompt tokens served from cache. Reads are the only part that
       * saves money — a high write share with a near-zero hit rate means the
       * cache is being paid for and never used.
       */
      cacheHitRate:
        totals!.totalInputTokens === 0
          ? 0
          : totals!.totalCacheReadTokens / totals!.totalInputTokens,
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
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
      cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
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
    totalCost += estimateCost(
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
    );
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    estimatedCost: totalCost,
  };
}

/**
 * USD a member has spent on the given callers since `since`.
 *
 * Scoped to callers rather than all usage on purpose: a chatty member should
 * not lock themselves out of the advisors through ordinary bot conversation.
 */
async function getSpendByCaller(
  telegramUserId: number,
  callers: string[],
  since: Date,
): Promise<number> {
  if (callers.length === 0) return 0;

  const rows = await db
    .select({
      model: aiUsage.model,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
      cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.telegramUserId, telegramUserId),
        gte(aiUsage.createdAt, since),
        inArray(aiUsage.caller, callers),
      ),
    )
    .groupBy(aiUsage.model);

  return rows.reduce(
    (total, row) =>
      total +
      estimateCost(
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
      ),
    0,
  );
}

/**
 * Per-member spend since `since`, highest first.
 *
 * Grouped by model as well as member so each member's cost can be summed at
 * that model's own rate — a member on Opus costs far more per token than one
 * on Haiku, which a token-only total hides.
 */
async function getUsageByUser(since: Date, limit: number) {
  const rows = await db
    .select({
      telegramUserId: aiUsage.telegramUserId,
      telegramUsername: user.telegramUsername,
      name: user.name,
      model: aiUsage.model,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
      cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
    })
    .from(aiUsage)
    .leftJoin(user, eq(sql`${aiUsage.telegramUserId}::text`, user.telegramId))
    .where(and(gte(aiUsage.createdAt, since), sql`${aiUsage.telegramUserId} is not null`))
    .groupBy(aiUsage.telegramUserId, user.telegramUsername, user.name, aiUsage.model);

  const byUser = new Map<
    number,
    { username: string | null; name: string | null; inputTokens: number; outputTokens: number; estimatedCost: number }
  >();

  for (const row of rows) {
    const id = Number(row.telegramUserId);
    const entry = byUser.get(id) ?? {
      username: row.telegramUsername,
      name: row.name,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };
    entry.inputTokens += row.inputTokens;
    entry.outputTokens += row.outputTokens;
    entry.estimatedCost += estimateCost(
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
    );
    byUser.set(id, entry);
  }

  return [...byUser.entries()]
    .map(([telegramUserId, v]) => ({ telegramUserId, ...v }))
    .sort((a, b) => b.estimatedCost - a.estimatedCost)
    .slice(0, limit);
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

async function getTopUsersByTokens(since: Date, limit: number, until?: Date) {
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
        until ? lte(aiUsage.createdAt, until) : undefined,
        eq(aiUsage.success, true),
      ),
    )
    .groupBy(aiUsage.telegramUserId, user.telegramUsername, user.name)
    .orderBy(desc(sql`sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens})`))
    .limit(limit);
}

// ── Public service ──────────────────────────────────────────

export const aiService = {
  currentModelFor,
  generateText: trackedGenerateText,
  generateObject: trackedGenerateObject,
  trackUsage,
  getUsageStats,
  getUsageSummary,
  getSpendByCaller,
  getUsageByUser,
  getTopUsersByTokens,
  resolveUserByUsername,
};
