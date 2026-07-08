import "../env";
import { QdrantClient } from "@qdrant/js-client-rest";

/**
 * Shared Qdrant Cloud client for Vigil.
 * Reads QDRANT_URL and QDRANT_API_KEY from the environment.
 */
const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;

if (!url) {
  throw new Error(
    "QDRANT_URL is not set. Add it to .env.local (see CLAUDE.md)."
  );
}

export const qdrant = new QdrantClient({
  url,
  apiKey,
  // Qdrant Cloud can be slow on cold start; give requests room.
  checkCompatibility: false,
});
