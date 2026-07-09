import { z } from "zod";

/**
 * Vigil workflow types — the structured contracts passed between the steps of
 * incidentResponseWorkflow. Every step's input and output is a Zod schema so it
 * can double as the step's runtime validation and its compile-time type
 * (inferred below). Steps 1-3 are implemented today; later steps reuse these.
 */

export const SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

/* ── Workflow input ──────────────────────────────────────────────────────── */

/** The alert that triggered the incident (from a monitor / pager). */
export const alertSchema = z.object({
  title: z.string().describe("Human-readable alert title."),
  service: z.string().optional().describe("Service the alert fired on."),
  severity: severitySchema.optional().describe("Declared severity, if known."),
});
export type Alert = z.infer<typeof alertSchema>;

/** Raw input to the whole workflow: an alert plus the raw log dump. */
export const incidentInputSchema = z.object({
  incidentId: z
    .string()
    .optional()
    .describe("Stable incident id; generated if omitted."),
  alert: alertSchema,
  rawLogs: z.string().describe("Raw, unstructured log text for the incident."),
});
export type IncidentInput = z.infer<typeof incidentInputSchema>;

/* ── Step 1: Ingest & Detect ─────────────────────────────────────────────── */

/** A single embedded log window, stored in the `log_chunks` collection. */
export const logChunkSchema = z.object({
  ref: z
    .string()
    .describe("Short, citable handle for this chunk (e.g. LOG-3)."),
  pointId: z.string().describe("Qdrant point id (UUID) for this chunk."),
  text: z.string().describe("Raw text of the log window."),
  service: z.string().nullable(),
  timestamp_start: z.string().nullable(),
  timestamp_end: z.string().nullable(),
});
export type LogChunk = z.infer<typeof logChunkSchema>;

/** The distilled fingerprint of the current incident. */
export const incidentSignatureSchema = z.object({
  incidentId: z.string(),
  affected_services: z.array(z.string()),
  primary_error_pattern: z
    .string()
    .describe("Representative error line that best characterizes the incident."),
  anomaly_start_timestamp: z.string().nullable(),
  severity: severitySchema,
  raw_log_count: z.number(),
});
export type IncidentSignature = z.infer<typeof incidentSignatureSchema>;

/** Step 1 output: the signature plus the chunks it produced. */
export const ingestOutputSchema = z.object({
  signature: incidentSignatureSchema,
  chunks: z.array(logChunkSchema),
});
export type IngestOutput = z.infer<typeof ingestOutputSchema>;

/* ── Step 2: Retrieve Similar ────────────────────────────────────────────── */

/** A past incident retrieved from Qdrant memory (mirrors searchIncidents). */
export const similarIncidentSchema = z.object({
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
});
export type SimilarIncident = z.infer<typeof similarIncidentSchema>;

/** A runbook retrieved from Qdrant (mirrors searchRunbooks). */
export const matchingRunbookSchema = z.object({
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
});
export type MatchingRunbook = z.infer<typeof matchingRunbookSchema>;

/**
 * Step 2 output. Carries the signature and chunks forward (so step 3 has the
 * full context in its inputData) alongside the retrieved memory.
 */
export const retrievalOutputSchema = z.object({
  signature: incidentSignatureSchema,
  chunks: z.array(logChunkSchema),
  similarIncidents: z.array(similarIncidentSchema),
  matchingRunbooks: z.array(matchingRunbookSchema),
});
export type RetrievalOutput = z.infer<typeof retrievalOutputSchema>;

/* ── Step 3: Grounded Root Cause ─────────────────────────────────────────── */

/**
 * A single ranked root-cause hypothesis. `evidence_ids` MUST reference real
 * evidence — log-chunk refs (LOG-n) or past-incident ids (INC-nnn). The
 * Grounding Gate (step 4, later) drops any hypothesis whose evidence is empty.
 */
export const rootCauseHypothesisSchema = z.object({
  explanation: z.string(),
  evidence_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  root_cause_category: z.string(),
});
export type RootCauseHypothesis = z.infer<typeof rootCauseHypothesisSchema>;

/** Step 3 output: hypotheses ranked by confidence (highest first). */
export const rootCauseOutputSchema = z.object({
  hypotheses: z.array(rootCauseHypothesisSchema),
});
export type RootCauseOutput = z.infer<typeof rootCauseOutputSchema>;
