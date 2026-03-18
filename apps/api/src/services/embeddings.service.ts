import {
  env as hfEnv,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { env } from "../env";

// On Railway, persist model weights to an attached volume.
// Locally, fall back to the OS cache directory.
const resolvedCacheDir =
  env.HF_CACHE_DIR ??
  (process.platform !== "win32"
    ? `${process.env.HOME}/.cache/huggingface`
    : undefined);
if (resolvedCacheDir) hfEnv.cacheDir = resolvedCacheDir;

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const DIMENSIONS = 384;

// Lazy singleton — loaded once on first call, reused for the process lifetime
let pipelineInstance: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelineInstance) return pipelineInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log("[embeddings] loading model:", MODEL_ID);
    const instance = await pipeline("feature-extraction", MODEL_ID);
    pipelineInstance = instance;
    console.log("[embeddings] model ready");
    return instance;
  })();

  return initPromise;
}

function extractVector(data: Float32Array, index: number): number[] {
  const start = index * DIMENSIONS;
  return Array.from(data.slice(start, start + DIMENSIONS));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  // output.data is Float32Array — single input so extract at index 0
  return extractVector(output.data as Float32Array, 0);
}

export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const data = output.data as Float32Array;
  return texts.map((_, i) => extractVector(data, i));
}
