/**
 * End-to-end smoke test for incidentResponseWorkflow steps 1-3.
 * Feeds a synthetic DB connection-pool-exhaustion log and verifies that step 3
 * returns grounded hypotheses whose evidence_ids are REAL (log refs or incident
 * ids that were actually produced upstream).
 *
 * Run with: npx tsx scripts/test-workflow.ts
 */
import "../src/mastra/env";
import {
  ingestAndDetect,
  retrieveSimilar,
  groundedRootCause,
} from "../src/mastra/workflows/incidentResponse";
import type { IncidentInput } from "../src/mastra/types";

const rawLogs = `2025-11-14T18:20:01Z [checkout-service] INFO request /checkout received user=8891
2025-11-14T18:22:14Z [checkout-service] WARN HikariPool-1 - Connection is not available, request queued
2025-11-14T18:22:15Z [checkout-service] ERROR HikariPool-1 - Connection is not available, request timed out after 30000ms
2025-11-14T18:22:16Z [payments-api] ERROR could not get JDBC connection; pool exhausted (active=20, idle=0, waiting=57)
2025-11-14T18:22:17Z [postgres-primary] WARN too many clients already; max_connections=20 reached
2025-11-14T18:22:19Z [checkout-service] ERROR HTTP 500 on POST /checkout p99 latency 8420ms
2025-11-14T18:22:20Z [payments-api] ERROR connection pool timeout waiting for free connection
2025-11-14T18:22:24Z [checkout-service] ERROR HikariPool-1 - Connection is not available, request timed out after 30000ms
2025-11-14T18:22:30Z [postgres-primary] WARN active connections pinned at pool max 20
2025-11-14T18:22:41Z [checkout-service] ERROR HTTP 500 on POST /checkout order abandoned`;

const input: IncidentInput = {
  alert: {
    title: "Checkout 500s during peak — DB connection pool exhausted",
    service: "checkout-service",
    severity: "P1",
  },
  rawLogs,
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  console.log("=== STEP 1: Ingest & Detect ===");
  const ingest = await ingestAndDetect(input);
  const sig = ingest.signature;
  console.log("  incidentId:            ", sig.incidentId);
  console.log("  affected_services:     ", sig.affected_services.join(", "));
  console.log("  primary_error_pattern: ", sig.primary_error_pattern);
  console.log("  anomaly_start:         ", sig.anomaly_start_timestamp);
  console.log("  severity:              ", sig.severity);
  console.log("  raw_log_count:         ", sig.raw_log_count);
  console.log("  chunks produced:       ", ingest.chunks.length);

  assert(ingest.chunks.length > 0, "step 1 produced at least one log chunk");
  assert(
    sig.affected_services.includes("checkout-service"),
    "affected_services includes checkout-service"
  );
  assert(sig.raw_log_count === 10, "raw_log_count counts all 10 log lines");

  console.log("\n=== STEP 2: Retrieve Similar ===");
  const retrieval = await retrieveSimilar(ingest);
  console.log("  similar incidents:");
  for (const s of retrieval.similarIncidents) {
    console.log(
      `    ${s.score.toFixed(3)}  ${s.incident_id}  [${s.root_cause_category}]  ${s.severity}`
    );
  }
  console.log("  matching runbooks:");
  for (const r of retrieval.matchingRunbooks) {
    console.log(`    ${r.score.toFixed(3)}  ${r.runbook_id}  ${r.title}`);
  }
  assert(
    retrieval.similarIncidents.length > 0,
    "step 2 retrieved at least one similar incident"
  );

  console.log("\n=== STEP 3: Grounded Root Cause ===");
  const rc = await groundedRootCause(retrieval);

  // Real, citable evidence ids that step 3 was allowed to use.
  const allowed = new Set<string>([
    ...ingest.chunks.map((c) => c.ref),
    ...retrieval.similarIncidents.map((s) => s.incident_id),
  ]);

  rc.hypotheses.forEach((h, i) => {
    console.log(
      `\n  #${i + 1}  confidence=${h.confidence.toFixed(2)}  category=${h.root_cause_category}`
    );
    console.log("     ", h.explanation);
    console.log("      evidence:", h.evidence_ids.join(", ") || "(none)");
  });

  assert(rc.hypotheses.length > 0, "step 3 returned at least one hypothesis");

  // Every cited id must be real (grounding invariant).
  for (const h of rc.hypotheses) {
    for (const id of h.evidence_ids) {
      assert(allowed.has(id), `evidence id "${id}" is a real, allowed id`);
    }
  }
  const grounded = rc.hypotheses.filter((h) => h.evidence_ids.length > 0);
  assert(
    grounded.length > 0,
    "at least one hypothesis is grounded with real evidence"
  );

  console.log("\n✅ Steps 1-3 ran end-to-end; hypotheses carry real citations.");
}

main().catch((e) => {
  console.error("\n❌ Workflow test FAILED:\n", e);
  process.exit(1);
});
