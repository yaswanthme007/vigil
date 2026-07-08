import "./env";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { groq } from "@ai-sdk/groq";

/**
 * Vigil — the core incident-response agent.
 *
 * Uses Groq's llama-3.1-8b-instant via the @ai-sdk/groq provider. The provider
 * reads GROQ_API_KEY from the environment. Embeddings (later days) still use
 * Google text-embedding-004 via GEMINI_API_KEY. Tools and the 8-step workflow
 * are wired in on later days.
 */
export const vigilAgent = new Agent({
  name: "Vigil",
  instructions:
    "You are Vigil, an AI agent that helps on-call engineers resolve production incidents safely.",
  model: groq("llama-3.1-8b-instant"),
});

export const mastra = new Mastra({
  agents: { vigilAgent },
});
