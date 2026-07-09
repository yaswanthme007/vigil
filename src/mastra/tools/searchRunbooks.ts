import "../env";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { qdrant } from "../qdrant/client";
import { embedQuery } from "../embeddings";

/**
 * searchRunbooks — semantic search over remediation runbooks in Qdrant.
 * Returns the top-3 most relevant runbooks for a described situation, including
 * their steps, risk level, and whether they require human approval. Used to draft
 * a proposed remediation grounded in an established procedure.
 */
export const searchRunbooks = createTool({
  id: "search-runbooks",
  description:
    "Search Vigil's runbook library for remediation procedures matching the current incident. Returns the top-3 most relevant runbooks with their steps, risk level, and whether they require human approval. Use this to propose a grounded, procedure-backed remediation.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Natural-language description of the incident or the symptom pattern to remediate."
      ),
    services: z
      .array(z.string())
      .optional()
      .describe(
        "Optional filter: only return runbooks that apply to any of these services."
      ),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        runbook_id: z.string(),
        title: z.string(),
        applies_to_services: z.array(z.string()),
        symptom_pattern: z.string(),
        steps: z.array(z.string()),
        risk_level: z.string(),
        requires_approval: z.boolean(),
        success_rate: z.number(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const { query, services } = context;
    const vector = await embedQuery(query);

    const must: Record<string, unknown>[] = [];
    if (services && services.length > 0) {
      must.push({ key: "applies_to_services", match: { any: services } });
    }

    const hits = await qdrant.search("runbooks", {
      vector: { name: "content_embedding", vector },
      limit: 3,
      with_payload: true,
      filter: must.length > 0 ? { must } : undefined,
    });

    const results = hits.map((h) => {
      const p = h.payload as Record<string, unknown>;
      return {
        id: String(h.id),
        score: h.score,
        runbook_id: p.runbook_id as string,
        title: p.title as string,
        applies_to_services: p.applies_to_services as string[],
        symptom_pattern: p.symptom_pattern as string,
        steps: p.steps as string[],
        risk_level: p.risk_level as string,
        requires_approval: p.requires_approval as boolean,
        success_rate: p.success_rate as number,
      };
    });

    return { results };
  },
});
