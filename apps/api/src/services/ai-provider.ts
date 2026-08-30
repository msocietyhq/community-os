import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import {
  AI_CATALOG,
  type AiModelKey,
  type AiProvider,
} from "@community-os/shared/ai-catalog";
import { env } from "../env";

type ProviderFn = (modelId: string) => LanguageModel;

/**
 * Built lazily and memoised: a provider whose key is absent must not throw at
 * import time just because some other provider's model was selected.
 */
const FACTORIES: Record<AiProvider, () => ProviderFn> = {
  anthropic: () => {
    const provider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return (modelId) => provider(modelId);
  },
  deepseek: () => {
    const apiKey = env.DEEPSEEK_API_KEY;
    // A backstop, not the normal path: `hasCredentials` gates this first and
    // resolveTier falls back to the tier default rather than reaching here.
    if (!apiKey) throw new Error("[ai-provider] DEEPSEEK_API_KEY is not set");
    const provider = createDeepSeek({ apiKey });
    return (modelId) => provider(modelId);
  },
};

const memo = new Map<AiProvider, ProviderFn>();

/** Whether the env var a model needs actually holds a value. */
export function hasCredentials(key: AiModelKey): boolean {
  const value = process.env[AI_CATALOG[key].envKey];
  return typeof value === "string" && value.length > 0;
}

export function modelFor(key: AiModelKey): LanguageModel {
  const def = AI_CATALOG[key];
  let factory = memo.get(def.provider);
  if (!factory) {
    factory = FACTORIES[def.provider]();
    memo.set(def.provider, factory);
  }
  return factory(def.modelId);
}
