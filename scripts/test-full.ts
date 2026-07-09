/**
 * Day 4 end-to-end test — the full 8-step pipeline via the run engine.
 *
 * Scenario A: run → awaiting approval → approve → post-mortem written →
 *             memory counter increments (the flywheel).
 * Scenario B: destructive remediation → Safety Gate blocks it (safe:false).
 *
 * Run with: npx tsx scripts/test-full.ts
 */
import "../src/mastra/env";
import {
  startRun,
  getRun,
  submitApproval,
  getMemoryCount,
} from "../src/mastra/engine/runStore";
import { SCENARIOS } from "../src/mastra/scenarios";
import type { IncidentInput } from "../src/mastra/types";
import type { RunState, RunStatus } from "../src/mastra/engine/runStore";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function inputFor(key: "A" | "B" | "C"): {
  input: IncidentInput;
  overrideSteps?: string[];
  overrideRollback?: string;
} {
  const s = SCENARIOS[key];
  return {
    input: {
      alert: { title: s.title, service: s.service, severity: s.severity },
      rawLogs: s.rawLogs,
    },
    overrideSteps: s.remediationOverride,
    overrideRollback: s.remediationRollback,
  };
}

async function pollUntil(
  runId: string,
  predicate: (r: RunState) => boolean,
  label: string,
  timeoutMs = 90000
): Promise<RunState> {
  const start = Date.now();
  let last: RunStatus | "" = "";
  while (Date.now() - start < timeoutMs) {
    const r = getRun(runId);
    if (r) {
      if (r.status !== last) {
        console.log(`    …step ${r.step} (${r.stepLabel}) — ${r.status}`);
        last = r.status;
      }
      if (predicate(r)) return r;
      if (r.status === "error") throw new Error(`run errored: ${r.error}`);
    }
    await wait(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function testScenarioA() {
  console.log("\n=== Scenario A — safe fix, approve, flywheel ===");
  const before = await getMemoryCount();
  console.log("  memory before:", before);

  const { input, overrideSteps, overrideRollback } = inputFor("A");
  const started = await startRun(input, {
    scenario: "A",
    overrideSteps,
    overrideRollback,
  });

  const suspended = await pollUntil(
    started.runId,
    (r) => r.status === "awaiting_approval",
    "awaiting_approval"
  );
  assert(!!suspended.remediation, "remediation plan produced");
  assert(suspended.remediation!.safety.safe === true, "safe fix passes Safety Gate");
  assert((suspended.hypotheses?.length ?? 0) > 0, "grounded hypotheses present");

  submitApproval(started.runId, {
    approved: true,
    engineer_id: "test-engineer",
  });

  const done = await pollUntil(
    started.runId,
    (r) => r.status === "completed",
    "completed"
  );
  assert(!!done.postmortem, "post-mortem generated");
  assert(done.postmortem!.incident_updated === true, "resolved incident written back");
  assert(done.postmortem!.quality_score > 0, "post-mortem has a quality score");

  const after = await getMemoryCount();
  console.log("  memory after:", after);
  assert(after === before + 1, "memory counter incremented (flywheel)");
}

async function testScenarioB() {
  console.log("\n=== Scenario B — destructive remediation is structurally unapprovable ===");
  const memBefore = await getMemoryCount();
  const { input, overrideSteps, overrideRollback } = inputFor("B");
  const started = await startRun(input, {
    scenario: "B",
    overrideSteps,
    overrideRollback,
  });

  const suspended = await pollUntil(
    started.runId,
    (r) => r.status === "blocked" || r.status === "escalated",
    "blocked"
  );
  assert(suspended.status === "blocked", "Safety Gate puts the run in 'blocked' (not awaiting_approval)");
  assert(!!suspended.remediation, "remediation plan produced");
  assert(
    suspended.remediation!.safety.safe === false,
    "Safety Gate flags the destructive plan as unsafe"
  );
  console.log("  block reasons:", suspended.remediation!.safety.reasons);

  // Attempt to approve the blocked plan — must be REFUSED.
  const result = submitApproval(started.runId, {
    approved: true,
    engineer_id: "test-engineer",
  });
  assert(result.refused === true, "approval of a blocked plan is REFUSED");
  assert(getRun(started.runId)!.status === "blocked", "run stays 'blocked' after refused approval");
  assert(!getRun(started.runId)!.postmortem, "no post-mortem written for a blocked plan");

  await wait(1500); // give any (incorrect) async post-mortem a chance to appear
  const memAfter = await getMemoryCount();
  console.log(`  memory before=${memBefore} after=${memAfter}`);
  assert(memAfter === memBefore, "memory did NOT increment for the blocked plan");
}

async function main() {
  await testScenarioA();
  await testScenarioB();
  console.log(
    "\n✅ Full 8-step pipeline verified: approve → post-mortem → memory increment; destructive plan blocked."
  );
}

main().catch((e) => {
  console.error("\n❌ Full pipeline test FAILED:\n", e);
  process.exit(1);
});
