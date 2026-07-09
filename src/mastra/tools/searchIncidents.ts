import "../env";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { qdrant } from "../qdrant/client";
import { embedQuery } from "../embeddings";

/**
 * searchIncidents — semantic search over past incidents in Qdrant memory.
 * Returns the top-5 most similar historical incidents with similarity scores so
 * root-cause hypotheses can cite real precedents. Supports optional filtering by
 * severity and affected services.
 */
export const searchIncidents = createTool({
  id: "search-incidents",
  description:
    "Search Vigil's memory of past incidents for ones similar to the current situation. Returns the top-5 most similar historical incidents with a similarity score each, including their root cause, remediation, and whether it worked. Use this to ground root-cause hypotheses in real precedent.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Natural-language description of the current incident: its symptoms, affected services, and observed behavior."
      ),
    severity: z
      .enum(["P1", "P2", "P3", "P4"])
      .optional()
      .describe("Optional filter: only return incidents of this severity."),
    services: z
      .array(z.string())
      .optional()
      .describe(
        "Optional filter: only return incidents that affected any of these services."
      ),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        incident_id: z.string(),
        summary: z.string(),
        services_affected: z.array(z.string()),
        symptoms: z.array(z.string()),
        root_cause_category: z.string(),
        remediation_applied: z.string(),
        remediation_worked: z.boolean(),
        mttr_minutes: z.number(),
        severity: z.string(),
        created_at: z.string(),
        postmortem_id: z.string().nullable(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { query, severity, services } = context;
    const vector = await embedQuery(query);

    const must: Record<string, unknown>[] = [];
    if (severity) must.push({ key: "severity", match: { value: severity } });
    if (services && services.length > 0) {
      must.push({ key: "services_affected", match: { any: services } });
    }

    const hits = await qdrant.search("incidents", {
      vector: { name: "summary_embedding", vector },
      limit: 5,
      with_payload: true,
      filter: must.length > 0 ? { must } : undefined,
    });

    const results = hits.map((h) => {
      const p = h.payload as Record<string, unknown>;
      return {
        id: String(h.id),
        score: h.score,
        incident_id: p.incident_id as string,
        summary: p.summary as string,
        services_affected: p.services_affected as string[],
        symptoms: p.symptoms as string[],
        root_cause_category: p.root_cause_category as string,
        remediation_applied: p.remediation_applied as string,
        remediation_worked: p.remediation_worked as boolean,
        mttr_minutes: p.mttr_minutes as number,
        severity: p.severity as string,
        created_at: p.created_at as string,
        postmortem_id: (p.postmortem_id as string | null) ?? null,
      };
    });

    return { results };
  },
});
