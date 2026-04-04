import { generateText } from "ai";
import { aiUsageService } from "../../services/ai-usage.service";

interface TrackingContext {
  caller: string;
  telegramUserId?: number | null;
  chatId?: string | null;
}

/**
 * Wrapper around `generateText` that auto-records token usage.
 * Fire-and-forget — tracking never blocks or throws.
 */
export async function trackedGenerateText(
  params: Parameters<typeof generateText>[0],
  ctx: TrackingContext,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const modelId =
    typeof params.model === "string"
      ? params.model
      : "modelId" in params.model
        ? params.model.modelId
        : "unknown";

  const start = performance.now();

  try {
    const result = await generateText(params);
    const durationMs = Math.round(performance.now() - start);

    aiUsageService
      .trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: true,
        durationMs,
      })
      .catch((err) => console.error("[ai-usage] tracking failed:", err));

    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);

    aiUsageService
      .trackUsage({
        model: modelId,
        caller: ctx.caller,
        inputTokens: 0,
        outputTokens: 0,
        telegramUserId: ctx.telegramUserId,
        chatId: ctx.chatId,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      })
      .catch((err) => console.error("[ai-usage] tracking failed:", err));

    throw error;
  }
}
