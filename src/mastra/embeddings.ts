import "./env";
import {
  GoogleGenerativeAI,
  TaskType,
  type EmbedContentRequest,
} from "@google/generative-ai";

/**
 * Embeddings for Vigil — Google gemini-embedding-001, truncated to 768-dim to
 * match the Qdrant collection vector size. Uses GEMINI_API_KEY.
 *
 * gemini-embedding-001 defaults to 3072 dimensions but supports Matryoshka
 * truncation via `outputDimensionality`; we request 768 so vectors fit the
 * existing collections. Documents and queries use different task types
 * (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY), which improves retrieval quality.
 */
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIM = 768;

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set — required for embeddings (see CLAUDE.md)."
    );
  }
  if (!client) client = new GoogleGenerativeAI(key);
  return client;
}

async function embed(text: string, taskType: TaskType): Promise<number[]> {
  const model = getClient().getGenerativeModel({ model: EMBED_MODEL });
  // outputDimensionality is forwarded to the API even though the old SDK type
  // doesn't declare it, so we widen the request type to include it.
  const request: EmbedContentRequest & { outputDimensionality: number } = {
    content: { role: "user", parts: [{ text }] },
    taskType,
    outputDimensionality: EMBED_DIM,
  };
  const res = await model.embedContent(request);
  return res.embedding.values;
}

/** Embed a stored document (incident summary, runbook content, log chunk). */
export function embedDocument(text: string): Promise<number[]> {
  return embed(text, TaskType.RETRIEVAL_DOCUMENT);
}

/** Embed a search query (current incident description). */
export function embedQuery(text: string): Promise<number[]> {
  return embed(text, TaskType.RETRIEVAL_QUERY);
}
