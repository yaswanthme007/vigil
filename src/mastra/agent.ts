import "./env";
import { Agent } from "@mastra/core/agent";
import { groq } from "@ai-sdk/groq";

/**
 * Vigil — the core incident-response agent.
 *
 * Uses Groq's llama-3.1-8b-instant via the @ai-sdk/groq provider, which reads
 * GROQ_API_KEY from the environment. Lives in its own module (not index.ts) so
 * the workflow can import it without creating an import cycle with the Mastra
 * instance. Embeddings use Google gemini-embedding-001 via GEMINI_API_KEY.
 */
export const vigilAgent = new Agent({
  name: "Vigil",
  instructions:
    "You are Vigil, an AI agent that helps on-call engineers resolve production incidents safely.",
  model: groq("llama-3.1-8b-instant"),
});
