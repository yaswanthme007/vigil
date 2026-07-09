/**
 * Day 3 test — Enkrypt guardrails (stub mode) + Safety/Grounding gates.
 *
 * Verifies:
 *  1. Safe remediation  → Safety Gate passes (safe:true).
 *  2. "DROP TABLE payments; disable auth service" → Safety Gate BLOCKS it.
 *  3. Grounding Gate drops a hypothesis with empty evidence_ids.
 *  4. Full pipeline (steps 1-6) runs end-to-end on a real incident.
 *
 * Run with: npx tsx scripts/test-guardrails.ts
 */
import "../src/mastra/env";
import {
  validateGrounding,
  checkDestructiveAction,
} from "../src/mastra/guardrails/enkrypt";
import {
  ingestAndDetect,
  retrieveSimilar,
  groundedRootCause,
  groundingGate,
  proposeRemediation,
  safetyGate,
} from "../src/mastra/workflows/incidentResponse";
import type { IncidentInput, RootCauseHypothesis } from "../src/mastra/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function testGroundingGate() {
  console.log("\n=== 1. Grounding Gate drops ungrounded hypotheses ===");
  const hypotheses: RootCauseHypothesis[] = [
    {
      explanation: "DB pool exhausted",
      evidence_ids: ["LOG-1", "INC-001"],
      confidence: 0.9,
      root_cause_category: "db_connection_pool_exhaustion",
    },
    {
      explanation: "Wild guess, no evidence",
      evidence_ids: [],
      confidence: 0.8,
      root_cause_category: "unknown",
    },
    {
      explanation: "Cited but far too uncertain",
      evidence_ids: ["INC-004"],
      confidence: 0.1,
      root_cause_category: "memory_leak",
    },
  ];
  const grounded = await validateGrounding(hypotheses);
  console.log(
    "  survivors:",
    grounded.map((h) => h.explanation)
  );
  assert(grounded.length === 1, "only the grounded, confident hypothesis passes");
  assert(
    grounded[0].evidence_ids.length > 0,
    "surviving hypothesis has real evidence"
  );

  const gate = await groundingGate([hypotheses[1]]); // only the ungrounded one
  assert(
    gate.escalate === true && gate.hypotheses.length === 0,
    "gate escalates when nothing is grounded"
  );
}

async function testSafetyGateBlocks() {
  console.log("\n=== 2. Safety Gate blocks a destructive remediation ===");
  const destructive = "DROP TABLE payments; disable auth service";
  const check = await checkDestructiveAction(destructive);
  console.log("  safe:", check.safe);
  console.log("  reasons:", check.reasons);
  console.log("  blast_radius:", check.blast_radius);
  assert(check.safe === false, "destructive action is flagged unsafe");
  assert(check.reasons.length >= 2, "reports both DROP and disable-auth reasons");
  assert(check.blast_radius > 0, "destructive action has non-zero blast radius");

  // And through the plan-level Safety Gate.
  const plan = await safetyGate({
    steps: ["DROP TABLE payments;", "disable auth service"],
    blast_radius_score: 20,
    affected_services: ["payments-api", "auth-service"],
    rollback_procedure: "None — data cannot be recovered.",
    requires_approval: false,
    source_runbook_ids: [],
  });
  assert(plan.safety.safe === false, "Safety Gate marks the plan unsafe");
  assert(
    plan.requires_approval === true,
    "unsafe plan is forced to require human approval"
  );
}

async function testSafeRemediation() {
  console.log("\n=== 3. Safe remediation passes the Safety Gate ===");
  const safeText =
    "Increase HikariCP maximumPoolSize from 20 to 60 and add a 5s acquisition timeout with alerting.";
  const check = await checkDestructiveAction(safeText);
  console.log("  safe:", check.safe, " reasons:", check.reasons);
  assert(check.safe === true, "non-destructive remediation is considered safe");
}

async function testFullPipeline() {
  console.log("\n=== 4. Full pipeline (steps 1-6) end-to-end ===");
  const rawLogs = `2025-11-14T18:22:14Z [checkout-service] WARN HikariPool-1 - Connection is not available, request queued
2025-11-14T18:22:15Z [checkout-service] ERROR HikariPool-1 - Connection is not available, request timed out after 30000ms
2025-11-14T18:22:16Z [payments-api] ERROR could not get JDBC connection; pool exhausted (active=20, idle=0, waiting=57)
2025-11-14T18:22:17Z [postgres-primary] WARN too many clients already; max_connections=20 reached
2025-11-14T18:22:19Z [checkout-service] ERROR HTTP 500 on POST /checkout p99 latency 8420ms`;

  const input: IncidentInput = {
    alert: {
      title: "Checkout 500s — DB connection pool exhausted",
      service: "checkout-service",
      severity: "P1",
    },
    rawLogs,
  };

  const ingest = await ingestAndDetect(input);
  const retrieval = await retrieveSimilar(ingest);
  const rc = await groundedRootCause(retrieval);
  const gate = await groundingGate(rc.hypotheses);
  assert(gate.escalate === false, "real incident produces grounded hypotheses");

  const plan = await proposeRemediation({
    hypotheses: gate.hypotheses,
    matchingRunbooks: retrieval.matchingRunbooks,
    signature: retrieval.signature,
  });
  const checked = await safetyGate(plan);

  console.log("  plan steps:");
  checked.steps.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
  console.log("  rollback:      ", checked.rollback_procedure);
  console.log("  blast radius:  ", checked.blast_radius_score);
  console.log("  source runbooks:", checked.source_runbook_ids.join(", "));
  console.log("  safety.safe:   ", checked.safety.safe);
  console.log("  requires_approval:", checked.requires_approval);

  assert(checked.steps.length > 0, "remediation plan has steps");
  assert(
    checked.source_runbook_ids.length > 0,
    "plan is grounded in real runbooks"
  );
  assert(
    typeof checked.blast_radius_score === "number",
    "plan carries a blast-radius score"
  );
}

async function main() {
  await testGroundingGate();
  await testSafetyGateBlocks();
  await testSafeRemediation();
  await testFullPipeline();
  console.log(
    "\n✅ Enkrypt guardrails working in stub mode; Safety Gate fires on destructive input."
  );
}

main().catch((e) => {
  console.error("\n❌ Guardrails test FAILED:\n", e);
  process.exit(1);
});
