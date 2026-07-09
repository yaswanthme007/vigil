/**
 * Smoke-test the search tools against seeded Qdrant data.
 * Run with: npx tsx scripts/test-search.ts
 */
import "../src/mastra/env";
import { searchIncidents } from "../src/mastra/tools/searchIncidents";
import { searchRunbooks } from "../src/mastra/tools/searchRunbooks";

// Tools are invoked as they would be by the agent: execute({ context }).
type AnyTool = { execute: (arg: { context: unknown }) => Promise<unknown> };

async function main() {
  const query =
    "Checkout API is returning 500 errors during peak traffic and the Postgres connection pool is exhausted with connection timeouts.";

  console.log("=== searchIncidents ===");
  console.log("query:", query, "\n");
  const inc = (await (searchIncidents as unknown as AnyTool).execute({
    context: { query },
  })) as { results: Array<Record<string, unknown>> };
  for (const r of inc.results) {
    console.log(
      `  ${(r.score as number).toFixed(3)}  ${r.incident_id}  [${r.root_cause_category}]  ${r.severity}`
    );
  }

  console.log("\n=== searchRunbooks ===");
  const rb = (await (searchRunbooks as unknown as AnyTool).execute({
    context: { query },
  })) as { results: Array<Record<string, unknown>> };
  for (const r of rb.results) {
    console.log(
      `  ${(r.score as number).toFixed(3)}  ${r.runbook_id}  ${r.title}  (risk: ${r.risk_level}, approval: ${r.requires_approval})`
    );
  }

  console.log("\n--- filtered: severity=P1, services=[payments-api] ---");
  const filtered = (await (searchIncidents as unknown as AnyTool).execute({
    context: { query, severity: "P1", services: ["payments-api"] },
  })) as { results: Array<Record<string, unknown>> };
  for (const r of filtered.results) {
    console.log(
      `  ${(r.score as number).toFixed(3)}  ${r.incident_id}  ${r.severity}  services=${JSON.stringify(r.services_affected)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
