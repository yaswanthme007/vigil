import "./env";
import { resolve } from "node:path";
import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";

/**
 * Embeddings for Vigil — LOCAL, using @xenova/transformers (all-MiniLM-L6-v2,
 * 384-dim). Runs entirely in-process with no API key, quota, or network call at
 * request time, so it cannot fail on stage the way a hosted embedding API can.
 *
 * The model weights are PRE-BUNDLED in the repo at ./models (quantized ONNX) and
 * loaded strictly from disk — allowRemoteModels is off, so there is ZERO network
 * call at runtime (not even a one-time Hugging Face fetch on first boot). Warm up
 * with `warmupEmbeddings()` at server start. Groq (LLM), Qdrant, and Enkrypt are
 * unchanged. GEMINI_API_KEY remains commented in .env.local as a documented
 * fallback path if we ever want to revert to hosted embeddings.
 *
 * The public interface is unchanged: embedDocument() / embedQuery() (and the
 * internal embed(text, taskType?)), so no calling code needs to change. taskType
 * is accepted for signature compatibility but the local model does not use it.
 */
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

// Load the model STRICTLY from the pre-bundled ./models directory — never the
// network. Resolved against cwd (all npm scripts + the server run from the repo
// root) so the path is stable regardless of how the process is launched.
env.localModelPath = resolve(process.cwd(), "models");
env.allowLocalModels = true; // read weights from ./models/<model>/...
env.allowRemoteModels = false; // hard-off: no Hugging Face fetch, ever

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/** Lazily load (and cache) the feature-extraction pipeline. */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBED_MODEL);
  }
  return extractorPromise;
}

/**
 * Embed a single piece of text into a 384-dim unit vector (mean-pooled +
 * L2-normalized, ideal for Qdrant cosine distance). `taskType` is ignored by the
 * local model and exists only to preserve the previous call signature.
 */
async function embed(text: string, _taskType?: unknown): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Embed a stored document (incident summary, runbook content, log chunk). */
export function embedDocument(text: string): Promise<number[]> {
  return embed(text);
}

/** Embed a search query (current incident description). */
export function embedQuery(text: string): Promise<number[]> {
  return embed(text);
}

/** Preload the model so the first real request doesn't pay the cold-start cost. */
export async function warmupEmbeddings(): Promise<void> {
  await embed("warmup");
}
