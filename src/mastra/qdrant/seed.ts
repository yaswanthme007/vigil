import "../env";
import { readFileSync } from "fs";
import { resolve } from "path";
import { qdrant } from "./client";
import { createAllCollections, createPayloadIndexes } from "./collections";
import { embedDocument } from "../embeddings";
import { stableId } from "../ids";

/**
 * Seeds Qdrant with Vigil's synthetic incidents and runbooks.
 *
 * Reads src/data/synthetic/{incidents,runbooks}.json, embeds each record with
 * Google text-embedding-004, and upserts into the `incidents` / `runbooks`
 * collections. Point IDs are deterministic UUIDs derived from the record id, so
 * re-running is idempotent (upsert, not duplicate).
 *
 * Run with: npm run seed
 */

interface Incident {
  incident_id: string;
  summary: string;
  services_affected: string[];
  symptoms: string[];
  root_cause_category: string;
  remediation_applied: string;
  remediation_worked: boolean;
  mttr_minutes: number;
  severity: string;
  created_at: string;
  postmortem_id: string | null;
}

interface Runbook {
  runbook_id: string;
  title: string;
  applies_to_services: string[];
  symptom_pattern: string;
  steps: string[];
  risk_level: string;
  requires_approval: boolean;
  success_rate: number;
}

function readJson<T>(relPath: string): T {
  const abs = resolve(process.cwd(), relPath);
  return JSON.parse(readFileSync(abs, "utf8")) as T;
}

/** Text fed to the embedding model for an incident (richer than summary alone). */
function incidentText(i: Incident): string {
  return [
    i.summary,
    `Category: ${i.root_cause_category}`,
    `Services: ${i.services_affected.join(", ")}`,
    `Symptoms: ${i.symptoms.join("; ")}`,
    `Remediation: ${i.remediation_applied}`,
  ].join("\n");
}

/** Text fed to the embedding model for a runbook. */
function runbookText(r: Runbook): string {
  return [
    r.title,
    `Applies to: ${r.applies_to_services.join(", ")}`,
    `Symptom pattern: ${r.symptom_pattern}`,
    `Steps: ${r.steps.join(" ")}`,
  ].join("\n");
}

async function seedIncidents(): Promise<number> {
  const incidents = readJson<Incident[]>("src/data/synthetic/incidents.json");
  const points = [];

  for (const inc of incidents) {
    const vector = await embedDocument(incidentText(inc));
    points.push({
      id: stableId(inc.incident_id),
      vector: { summary_embedding: vector },
      payload: { ...inc },
    });
    process.stdout.write(`  embedded ${inc.incident_id}\r`);
  }

  await qdrant.upsert("incidents", { wait: true, points });
  return points.length;
}

async function seedRunbooks(): Promise<number> {
  const runbooks = readJson<Runbook[]>("src/data/synthetic/runbooks.json");
  const points = [];

  for (const rb of runbooks) {
    const vector = await embedDocument(runbookText(rb));
    points.push({
      id: stableId(rb.runbook_id),
      vector: { content_embedding: vector },
      payload: { ...rb },
    });
    process.stdout.write(`  embedded ${rb.runbook_id}\r`);
  }

  await qdrant.upsert("runbooks", { wait: true, points });
  return points.length;
}

async function main() {
  console.log("=== Vigil seed ===\n");

  console.log("Ensuring collections exist...");
  const created = await createAllCollections();
  console.log(
    created.length ? `  created: ${created.join(", ")}` : "  all present"
  );

  console.log("Ensuring payload indexes...");
  await createPayloadIndexes();
  console.log("  ✓ filterable fields indexed");

  console.log("\nSeeding incidents...");
  const nIncidents = await seedIncidents();
  console.log(`\n  ✓ upserted ${nIncidents} incidents`);

  console.log("\nSeeding runbooks...");
  const nRunbooks = await seedRunbooks();
  console.log(`\n  ✓ upserted ${nRunbooks} runbooks`);

  // Confirm counts in Qdrant.
  const inc = await qdrant.count("incidents", { exact: true });
  const rb = await qdrant.count("runbooks", { exact: true });
  console.log("\n--- Qdrant point counts ---");
  console.log(`  incidents: ${inc.count}`);
  console.log(`  runbooks:  ${rb.count}`);

  if (inc.count < nIncidents || rb.count < nRunbooks) {
    throw new Error("Point counts lower than expected after upsert.");
  }

  console.log("\n✅ Seed complete.");
}

main().catch((err) => {
  console.error("\n❌ Seed FAILED:\n", err);
  process.exit(1);
});
