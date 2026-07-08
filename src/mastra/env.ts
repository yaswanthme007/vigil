import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Loads environment variables for Vigil.
 *
 * In the Next.js runtime, `.env.local` is loaded automatically, so this is a
 * no-op there. In standalone scripts run via `tsx` (e.g. scripts/test-setup.ts),
 * `.env.local` is NOT loaded automatically, so we parse it manually.
 *
 * We also bridge GEMINI_API_KEY (our project convention, per CLAUDE.md) to
 * GOOGLE_GENERATIVE_AI_API_KEY, which is the env var Mastra's model router
 * expects for the Google provider.
 */
function loadEnvFile(): void {
  // If the keys are already present (Next.js runtime), skip file parsing.
  if (process.env.GEMINI_API_KEY && process.env.QDRANT_URL) return;

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

// Mastra's Google provider reads GOOGLE_GENERATIVE_AI_API_KEY; bridge our key.
if (
  process.env.GEMINI_API_KEY &&
  !process.env.GOOGLE_GENERATIVE_AI_API_KEY
) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
}
