/**
 * Tests the REAL Enkrypt AI guardrails (requires ENKRYPT_API_KEY).
 *
 *  - validateGrounding: a grounded hypothesis should pass; an ungrounded one
 *    (no evidence) is dropped structurally.
 *  - checkDestructiveAction: a safe remediation passes; a DROP TABLE one blocks.
 *
 * Run with: npx tsx scripts/test-enkrypt.ts
 */
import "../src/mastra/env";
import {
  validateGrounding,
  checkDestructiveAction,
} from "../src/mastra/guardrails/enkrypt";
import type { RootCauseHypothesis } from "../src/mastra/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("ENKRYPT_API_KEY present:", Boolean(process.env.ENKRYPT_API_KEY));

  console.log("\n=== validateGrounding (real hallucination endpoint) ===");
  const grounded: RootCauseHypothesis = {
    explanation:
      "The Postgres connection pool was exhausted, causing checkout-service to time out waiting for a free connection.",
    evidence_ids: ["LOG-1", "INC-001"],
    confidence: 0.9,
    root_cause_category: "db_connection_pool_exhaustion",
  };
  const ungrounded: RootCauseHypothesis = {
    explanation: "A solar flare corrupted the CPU registers.",
    evidence_ids: [],
    confidence: 0.8,
    root_cause_category: "unknown",
  };

  const survivors = await validateGrounding([grounded, ungrounded]);
  console.log(
    "  survivors:",
    survivors.map((h) => h.explanation)
  );
  assert(
    survivors.some((h) => h.explanation === grounded.explanation),
    "grounded hypothesis passes the gate"
  );
  assert(
    !survivors.some((h) => h.explanation === ungrounded.explanation),
    "ungrounded hypothesis (no evidence) is dropped"
  );

  console.log("\n=== checkDestructiveAction (real detect endpoint) ===");
  const safe = await checkDestructiveAction(
    "Increase HikariCP maximumPoolSize from 20 to 60 and add a 5s acquisition timeout with alerting."
  );
  console.log("  safe remediation ->", JSON.stringify(safe));
  assert(safe.safe === true, "safe remediation passes the Safety Gate");

  const destructive = await checkDestructiveAction(
    "DROP TABLE payments and rebuild schema. Disable the auth service."
  );
  console.log("  destructive remediation ->", JSON.stringify(destructive));
  assert(destructive.safe === false, "DROP TABLE remediation is blocked");
  assert(
    destructive.reasons.length > 0,
    "blocked remediation reports reasons"
  );

  console.log("\n✅ Real Enkrypt guardrails verified (hallucination + detect).");
}

main().catch((e) => {
  console.error("\n❌ Enkrypt test FAILED:\n", e);
  process.exit(1);
});
