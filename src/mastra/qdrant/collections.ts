import { qdrant } from "./client";

/**
 * Vigil's 4 Qdrant collections (per CLAUDE.md).
 * All vectors are 384-dim (local @xenova/transformers all-MiniLM-L6-v2) with
 * cosine distance.
 *
 * Each collection uses a NAMED vector matching its schema field so that the
 * intent of each embedding stays explicit end-to-end.
 */

export const VECTOR_SIZE = 384;
export const DISTANCE = "Cosine" as const;

/** Collection name -> the named vector field it stores. */
export const COLLECTIONS: Record<string, string> = {
  incidents: "summary_embedding",
  log_chunks: "chunk_embedding",
  runbooks: "content_embedding",
  postmortems: "content_embedding",
};

/**
 * Creates all 4 Vigil collections that do not already exist.
 * Safe to run repeatedly (idempotent).
 */
export async function createAllCollections(): Promise<string[]> {
  const existing = await qdrant.getCollections();
  const existingNames = new Set(existing.collections.map((c) => c.name));

  const created: string[] = [];

  for (const [name, vectorField] of Object.entries(COLLECTIONS)) {
    if (existingNames.has(name)) continue;

    await qdrant.createCollection(name, {
      vectors: {
        [vectorField]: {
          size: VECTOR_SIZE,
          distance: DISTANCE,
        },
      },
    });
    created.push(name);
  }

  return created;
}

/**
 * Drops and recreates all 4 collections. Use when the vector dimensionality
 * changes (e.g. switching embedding models) — Qdrant cannot resize a collection
 * in place, so it must be dropped and rebuilt, then reseeded.
 */
export async function recreateAllCollections(): Promise<void> {
  for (const name of Object.keys(COLLECTIONS)) {
    try {
      await qdrant.deleteCollection(name);
    } catch {
      // Collection didn't exist — fine.
    }
  }
  await createAllCollections();
  await createPayloadIndexes();
}

/**
 * Payload fields that the search tools filter on. Qdrant requires a keyword
 * index on any payload field used in a filter, so we create them explicitly.
 */
export const PAYLOAD_INDEXES: Record<string, string[]> = {
  incidents: ["severity", "services_affected", "root_cause_category"],
  runbooks: ["applies_to_services", "risk_level"],
};

/**
 * Ensures keyword payload indexes exist for all filterable fields.
 * Idempotent: re-creating an existing index is a no-op we can safely ignore.
 */
export async function createPayloadIndexes(): Promise<void> {
  for (const [collection, fields] of Object.entries(PAYLOAD_INDEXES)) {
    for (const field of fields) {
      try {
        await qdrant.createPayloadIndex(collection, {
          field_name: field,
          field_schema: "keyword",
          wait: true,
        });
      } catch {
        // Index already exists (or is being created) — safe to ignore.
      }
    }
  }
}
