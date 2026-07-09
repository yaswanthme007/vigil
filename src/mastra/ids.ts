import { createHash } from "crypto";

/**
 * Deterministic UUIDv5-style id derived from a stable string.
 * Same input -> same id, so Qdrant upserts are idempotent (no duplicates on
 * re-run). Shared by the seeder and the live-incident log-chunk writer.
 */
export function stableId(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    variant + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}
