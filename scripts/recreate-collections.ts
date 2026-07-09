/**
 * Drops and recreates all 4 Qdrant collections at the current VECTOR_SIZE.
 * Needed when the embedding dimensionality changes (Qdrant can't resize in
 * place). Follow with `npm run seed` to repopulate.
 *
 * Run with: npx tsx scripts/recreate-collections.ts
 */
import "../src/mastra/env";
import { recreateAllCollections } from "../src/mastra/qdrant/collections";
import { VECTOR_SIZE } from "../src/mastra/qdrant/collections";

async function main() {
  console.log(`Recreating all collections at ${VECTOR_SIZE}-dim…`);
  await recreateAllCollections();
  console.log("✅ Collections recreated + payload indexes rebuilt.");
}

main().catch((e) => {
  console.error("recreate failed:", e);
  process.exit(1);
});
