/**
 * Day-0 setup verification.
 *
 * 1. Calls the Vigil agent with "hello" (verifies Gemini via Mastra).
 * 2. Creates all 4 Qdrant collections (verifies Qdrant connection + write).
 * 3. Lists collections and confirms all 4 exist.
 *
 * Run with: npm run test:setup
 */
import "../src/mastra/env";
import { vigilAgent } from "../src/mastra";
import { qdrant } from "../src/mastra/qdrant/client";
import {
  createAllCollections,
  COLLECTIONS,
} from "../src/mastra/qdrant/collections";

async function main() {
  console.log("=== Vigil Day-0 Setup Test ===\n");

  // --- 1. Gemini via Mastra ------------------------------------------------
  console.log("[1/3] Testing Vigil agent (Gemini 2.0 Flash via Mastra)...");
  const res = await vigilAgent.generate("hello");
  console.log("  Agent response:", res.text.trim());
  console.log("  ✓ Gemini connection OK\n");

  // --- 2. Create Qdrant collections ---------------------------------------
  console.log("[2/3] Creating Qdrant collections...");
  const created = await createAllCollections();
  if (created.length > 0) {
    console.log("  Created:", created.join(", "));
  } else {
    console.log("  All collections already existed.");
  }
  console.log("  ✓ Qdrant write OK\n");

  // --- 3. Verify all 4 exist ----------------------------------------------
  console.log("[3/3] Verifying collections in Qdrant...");
  const { collections } = await qdrant.getCollections();
  const names = new Set(collections.map((c) => c.name));

  const expected = Object.keys(COLLECTIONS);
  const missing = expected.filter((n) => !names.has(n));

  for (const name of expected) {
    console.log(`  ${names.has(name) ? "✓" : "✗"} ${name}`);
  }

  if (missing.length > 0) {
    throw new Error(`Missing collections: ${missing.join(", ")}`);
  }

  console.log("\n✅ All systems go — Gemini + Qdrant verified.");
}

main().catch((err) => {
  console.error("\n❌ Setup test FAILED:\n", err);
  process.exit(1);
});
