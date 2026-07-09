import "./env";
import { Mastra } from "@mastra/core";
import { vigilAgent } from "./agent";
import { incidentResponseWorkflow } from "./workflows/incidentResponse";

/**
 * The Mastra instance wiring Vigil's agent and workflows together.
 * The agent itself lives in ./agent so workflow modules can import it without
 * an import cycle.
 */
export { vigilAgent };

export const mastra = new Mastra({
  agents: { vigilAgent },
  workflows: { incidentResponseWorkflow },
});
