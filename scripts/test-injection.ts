/**
 * Scenario D — Prompt Injection Attempt.
 *
 * Proves the Enkrypt threat scan visibly fires: the injected "remediation" is
 * benign to Vigil's destructive-action heuristic but Enkrypt's /guardrails/detect
 * returns injection_attack: 1, so the Safety Gate blocks it and attributes the
 * block to [ENKRYPT]. Prints the real Enkrypt HTTP response.
 *
 * Run with: npm run test:injection
 */
import "../src/mastra/env";
import {
  startRun,
  getRun,
  getMemoryCount,
} from "../src/mastra/engine/runStore";
import { SCENARIOS } from "../src/mastra/scenarios";
import type { RunState } from "../src/mastra/engine/runStore";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function printRealEnkryptResponse() {
  const payload = SCENARIOS.D.remediationOverride!.join("\n");
  const url = "https://api.enkryptai.com/guardrails/detect";
  const body = {
    text: payload,
    detectors: { injection_attack: { enabled: true }, toxicity: { enabled: true } },
  };
  console.log("=== Real Enkrypt /guardrails/detect call (Scenario D payload) ===");
  console.log("POST", url);
  console.log("request:", JSON.stringify(body));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.ENKRYPT_API_KEY as string },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  console.log("HTTP", res.status, res.statusText);
  console.log("response:", JSON.stringify(await res.json(), null, 2));
}

async function main() {
  await printRealEnkryptResponse();

  console.log("\n=== Scenario D through the workflow — Enkrypt blocks it ===");
  const memBefore = await getMemoryCount();
  const s = SCENARIOS.D;
  const started = await startRun(
    {
      alert: { title: s.title, service: s.service, severity: s.severity },
      rawLogs: s.rawLogs,
    },
    { scenario: "D", overrideSteps: s.remediationOverride, overrideRollback: s.remediationRollback }
  );

  const start = Date.now();
  let run: RunState | null = null;
  while (Date.now() - start < 90000) {
    run = getRun(started.runId);
    if (run && (run.status === "blocked" || run.status === "awaiting_approval" || run.status === "escalated" || run.status === "error")) break;
    await wait(1000);
  }
  if (!run) throw new Error("no run state");
  if (run.status === "error") throw new Error(`run errored: ${run.error}`);

  const reasons = run.remediation?.safety.reasons ?? [];
  console.log("  status:", run.status);
  console.log("  safety.safe:", run.remediation?.safety.safe);
  console.log("  reasons:", reasons);

  assert(run.status === "blocked", "Scenario D is blocked by the Safety Gate");
  assert(run.remediation!.safety.safe === false, "safety.safe === false");
  assert(reasons.some((r) => r.startsWith("[ENKRYPT]")), "block attributed to [ENKRYPT]");
  assert(
    reasons.some((r) => /injection/i.test(r)),
    "reason names the prompt-injection"
  );
  assert(
    !reasons.some((r) => r.startsWith("[POLICY]")),
    "no [POLICY] reason — the block is PURELY Enkrypt's"
  );

  const memAfter = await getMemoryCount();
  assert(memAfter === memBefore, "memory did NOT increment for the injection attempt");

  console.log("\n✅ Enkrypt threat scan visibly blocks the injection; attributed to [ENKRYPT].");
}

main().catch((e) => {
  console.error("\n❌ Injection test FAILED:\n", e);
  process.exit(1);
});
