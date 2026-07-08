import "./env";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";

/**
 * Vigil — the core incident-response agent.
 *
 * Uses Google Gemini 2.0 Flash via Mastra's model routing. The provider API key
 * is read from GOOGLE_GENERATIVE_AI_API_KEY (bridged from GEMINI_API_KEY in
 * ./env). Tools and the 8-step workflow are wired in on later days.
 */
export const vigilAgent = new Agent({
  name: "Vigil",
  instructions:
    "You are Vigil, an AI agent that helps on-call engineers resolve production incidents safely.",
  model: "google/gemini-2.0-flash",
});

export const mastra = new Mastra({
  agents: { vigilAgent },
});
