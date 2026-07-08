import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Loads environment variables for Vigil.
 *
 * In the Next.js runtime, `.env.local` is loaded automatically, so this is a
 * no-op there. In standalone scripts run via `tsx` (e.g. scripts/test-setup.ts),
 * `.env.local` is NOT loaded automatically, so we parse it manually.
 *
 * Keys:
 * - GROQ_API_KEY  — LLM (Groq llama-3.1-8b-instant via @ai-sdk/groq)
 * - GEMINI_API_KEY — embeddings only (Google text-embedding-004)
 * - QDRANT_URL / QDRANT_API_KEY — vector store
 */
function loadEnvFile(): void {
  // If the keys are already present (Next.js runtime), skip file parsing.
  if (process.env.GROQ_API_KEY && process.env.QDRANT_URL) return;

  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();

      // Strip surrounding quotes if present.
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local not found — rely on whatever is already in process.env.
  }
}

loadEnvFile();
