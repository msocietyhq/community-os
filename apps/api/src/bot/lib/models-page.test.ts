import { describe, expect, test } from "bun:test";
import {
  AI_CATALOG,
  DEFAULT_TIER_MODELS,
  type AiModelKey,
} from "@community-os/shared/ai-catalog";
import { renderModelsPage } from "./models-page";

const allKeys = Object.keys(AI_CATALOG) as AiModelKey[];

const page = (over: Partial<Parameters<typeof renderModelsPage>[0]> = {}) =>
  renderModelsPage({
    tierModels: DEFAULT_TIER_MODELS,
    configured: allKeys,
    ...over,
  });

describe("renderModelsPage", () => {
  test("lists every catalog model with key, provider id and pricing", () => {
    const out = page();
    for (const key of allKeys) {
      const def = AI_CATALOG[key];
      expect(out, `${key} key`).toContain(key);
      expect(out, `${key} model id`).toContain(def.modelId);
      expect(out, `${key} label`).toContain(def.label);
      expect(out, `${key} input price`).toContain(
        `$${def.pricing.input.toFixed(2)} in`,
      );
      expect(out, `${key} output price`).toContain(
        `$${def.pricing.output.toFixed(2)} out`,
      );
    }
  });

  test("marks which tiers currently use a model", () => {
    // Haiku is the default for both micro and fast.
    expect(page()).toContain("in use: micro, fast");
  });

  test("flags a model that cannot be selected everywhere", () => {
    // DeepSeek is toolLoop: false, so it is confined to micro.
    const out = page();
    if (allKeys.some((k) => !AI_CATALOG[k].toolLoop)) {
      expect(out).toContain("only selectable for micro");
    }
  });

  test("flags a model whose provider key is missing", () => {
    const out = page({ configured: [] });
    expect(out).toContain("not set");
  });

  test("says nothing about keys when every provider is configured", () => {
    expect(page()).not.toContain("not set");
  });

  // Telegram fails the whole message on malformed HTML, so the rendered page
  // must never contain a stray unescaped angle bracket outside its own tags.
  test("produces balanced HTML tags", () => {
    const out = page();
    for (const tag of ["b", "i", "code"]) {
      const open = (out.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
      const close = (out.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      expect(open, `<${tag}> balance`).toBe(close);
    }
  });
});
