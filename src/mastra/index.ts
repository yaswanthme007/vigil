import "./env";
import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { vigilAgent } from "./agent";
import { incidentResponseWorkflow } from "./workflows/incidentResponse";

/**
 * The Mastra instance wiring Vigil's agent and workflows together.
 * The agent itself lives in ./agent so workflow modules can import it without
 * an import cycle.
 *
 * An in-process InMemoryStore is configured so the workflow can persist its
 * suspended snapshot at the Human-Approval step and be resumed later (in the
 * same long-lived server process — same single-process assumption the dashboard
 * engine already relies on). Without a storage adapter, resume() throws
 * "No snapshot found for this workflow run".
 */
export { vigilAgent };

export const mastra = new Mastra({
  agents: { vigilAgent },
  workflows: { incidentResponseWorkflow },
  storage: new InMemoryStore(),
});
