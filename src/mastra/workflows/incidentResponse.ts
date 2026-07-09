import "../env";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { qdrant } from "../qdrant/client";
import { createAllCollections } from "../qdrant/collections";
import { embedDocument } from "../embeddings";
import { stableId } from "../ids";
import { vigilAgent } from "../agent";
import { searchIncidents } from "../tools/searchIncidents";
import { searchRunbooks } from "../tools/searchRunbooks";
import {
  incidentInputSchema,
  ingestOutputSchema,
  retrievalOutputSchema,
  rootCauseOutputSchema,
  type IncidentInput,
  type IngestOutput,
  type RetrievalOutput,
  type RootCauseOutput,
  type LogChunk,
  type IncidentSignature,
  type Severity,
  type RootCauseHypothesis,
} from "../types";

/**
 * incidentResponseWorkflow — steps 1-3 (Ingest & Detect → Retrieve Similar →
 * Grounded Root Cause). The remaining steps (Enkrypt gates, remediation,
 * approval, post-mortem) are added on later days.
 *
 * Each step's business logic lives in a plain exported async function so it can
 * be unit-tested directly; the createStep wrappers are thin adapters.
 */

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 128;
const LOG_CHUNK_TTL_SECONDS = 72 * 3600; // per CLAUDE.md: log_chunks ttl 72h

/* Tools expose a validated execute({ context }); type it minimally for reuse. */
type ToolLike<I, O> = { execute: (arg: { context: I }) => Promise<O> };
const runIncidentSearch = searchIncidents as unknown as ToolLike<
  { query: string; severity?: Severity; services?: string[] },
  { results: RetrievalOutput["similarIncidents"] }
>;
const runRunbookSearch = searchRunbooks as unknown as ToolLike<
  { query: string; services?: string[] },
  { results: RetrievalOutput["matchingRunbooks"] }
>;

/* ── Log parsing helpers (deterministic anomaly detection) ────────────────── */

const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/;
const SERVICE_RE =
  /\b([a-z][a-z0-9-]*-(?:service|api|db|gateway|worker|cache|queue|primary|replica|proxy))\b/g;
const ERROR_LINE_RE =
  /\b(error|fatal|critical|exception|timeout|timed out|exhaust|refused|unavailable|oom|out of memory|panic|5\d\d)\b/i;

/** Split raw logs into overlapping character windows. */
export function chunkLogs(
  raw: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  if (text.length <= size) return [text];

  const stride = size - overlap;
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += stride) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}

/** First ISO-ish timestamp found in a string, or null. */
function firstTimestamp(text: string): string | null {
  const m = text.match(TIMESTAMP_RE);
  return m ? m[0] : null;
}

/** Collect distinct service-looking tokens from a block of text. */
function extractServices(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(SERVICE_RE)) found.add(m[1]);
  // Also honor explicit `service=<name>` tags.
  for (const m of text.matchAll(/service[=:]\s*([a-z][a-z0-9-]+)/gi)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

/**
 * Pick the representative primary error line: the most frequent error signature
 * (timestamps and numbers normalized away), returned in its original wording.
 */
function detectPrimaryErrorPattern(lines: string[]): string | null {
  const errorLines = lines.filter((l) => ERROR_LINE_RE.test(l));
  if (errorLines.length === 0) return null;

  const normalize = (l: string) =>
    l
      .replace(TIMESTAMP_RE, "")
      .replace(/\b\d+(\.\d+)?\b/g, "N")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const counts = new Map<string, { count: number; sample: string }>();
  for (const line of errorLines) {
    const key = normalize(line);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, sample: line.trim() });
  }

  let best = { count: 0, sample: errorLines[0].trim() };
  for (const entry of counts.values()) {
    if (entry.count > best.count) best = entry;
  }
  // Strip a leading timestamp from the sample for a cleaner search query.
  return best.sample.replace(TIMESTAMP_RE, "").replace(/^[\s|:-]+/, "").trim();
}

/** Infer severity from error keywords when the alert doesn't declare one. */
function inferSeverity(text: string): Severity {
  const t = text.toLowerCase();
  if (/(exhaust|out of memory|oom|outage|down|panic|data loss|fatal)/.test(t)) {
    return "P1";
  }
  if (/(timeout|timed out|degrad|refused|unavailable|5\d\d)/.test(t)) {
    return "P2";
  }
  return "P3";
}

/* ── Step 1: Ingest & Detect ─────────────────────────────────────────────── */

export async function ingestAndDetect(
  input: IncidentInput
): Promise<IngestOutput> {
  const incidentId =
    input.incidentId ?? `INC-LIVE-${Date.now().toString(36).toUpperCase()}`;
  const lines = input.rawLogs.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // Deterministic anomaly detection.
  const alertServices = input.alert.service ? [input.alert.service] : [];
  const affected_services = [
    ...new Set([...alertServices, ...extractServices(input.rawLogs)]),
  ];
  if (affected_services.length === 0) affected_services.push("unknown");

  const primary_error_pattern =
    detectPrimaryErrorPattern(lines) ?? input.alert.title;

  const errorTimestamps = lines
    .filter((l) => ERROR_LINE_RE.test(l))
    .map(firstTimestamp)
    .filter((t): t is string => t !== null)
    .sort();
  const anomaly_start_timestamp =
    errorTimestamps[0] ?? firstTimestamp(input.rawLogs);

  const severity =
    input.alert.severity ??
    inferSeverity(`${input.alert.title}\n${primary_error_pattern}`);

  const signature: IncidentSignature = {
    incidentId,
    affected_services,
    primary_error_pattern,
    anomaly_start_timestamp,
    severity,
    raw_log_count: lines.length,
  };

  // Embed each chunk and upsert into log_chunks.
  await createAllCollections();
  const rawChunks = chunkLogs(input.rawLogs);
  const chunks: LogChunk[] = [];
  const points = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const text = rawChunks[i];
    const vector = await embedDocument(text);
    const pointId = stableId(`${incidentId}::chunk-${i}`);
    const ref = `LOG-${i + 1}`;
    const chunkServices = extractServices(text);
    const service = chunkServices[0] ?? affected_services[0] ?? null;
    const timestamp_start = firstTimestamp(text);
    const stamps = [...text.matchAll(new RegExp(TIMESTAMP_RE, "g"))].map(
      (m) => m[0]
    );
    const timestamp_end = stamps.length ? stamps[stamps.length - 1] : null;

    chunks.push({ ref, pointId, text, service, timestamp_start, timestamp_end });
    points.push({
      id: pointId,
      vector: { chunk_embedding: vector },
      payload: {
        ref,
        raw_text: text,
        incident_id: incidentId,
        service,
        timestamp_start,
        timestamp_end,
        ttl: LOG_CHUNK_TTL_SECONDS,
        created_at: new Date().toISOString(),
      },
    });
  }

  if (points.length > 0) {
    await qdrant.upsert("log_chunks", { wait: true, points });
  }

  return { signature, chunks };
}

/* ── Step 2: Retrieve Similar ────────────────────────────────────────────── */

export async function retrieveSimilar(
  input: IngestOutput
): Promise<RetrievalOutput> {
  const { signature } = input;

  const [incidentHits, runbookHits] = await Promise.all([
    runIncidentSearch.execute({
      context: {
        query: signature.primary_error_pattern,
        severity: signature.severity,
      },
    }),
    runRunbookSearch.execute({
      context: {
        query: signature.primary_error_pattern,
        services: signature.affected_services,
      },
    }),
  ]);

  return {
    signature,
    chunks: input.chunks,
    similarIncidents: incidentHits.results,
    matchingRunbooks: runbookHits.results,
  };
}

/* ── Step 3: Grounded Root Cause ─────────────────────────────────────────── */

/** Pull the first balanced JSON array out of a possibly noisy LLM response. */
function extractJsonArray(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function groundedRootCause(
  input: RetrievalOutput
): Promise<RootCauseOutput> {
  const { signature, chunks, similarIncidents } = input;

  // The allow-list of citable evidence ids: log-chunk refs + past incident ids.
  const allowedIds = new Set<string>([
    ...chunks.map((c) => c.ref),
    ...similarIncidents.map((s) => s.incident_id),
  ]);

  const logEvidence = chunks
    .map(
      (c) =>
        `[${c.ref}] (service=${c.service ?? "?"}) ${c.text
          .replace(/\s+/g, " ")
          .slice(0, 280)}`
    )
    .join("\n");

  const incidentEvidence = similarIncidents
    .map(
      (s) =>
        `[${s.incident_id}] category=${s.root_cause_category}, severity=${s.severity}, worked=${s.remediation_worked} — ${s.summary}`
    )
    .join("\n");

  const prompt = `You are Vigil's root-cause analysis engine. Analyze the incident below and produce EXACTLY 3 ranked root-cause hypotheses (most likely first).

INCIDENT SIGNATURE
- services: ${signature.affected_services.join(", ")}
- severity: ${signature.severity}
- primary error: ${signature.primary_error_pattern}

LOG EVIDENCE (cite these by their ref, e.g. LOG-1):
${logEvidence || "(none)"}

SIMILAR PAST INCIDENTS (cite these by their id, e.g. INC-001):
${incidentEvidence || "(none)"}

STRICT RULES:
- Every hypothesis MUST cite at least one evidence id in "evidence_ids".
- Cite ONLY ids that appear literally above (${[...allowedIds].join(", ") || "none available"}). Never invent ids.
- "confidence" is a number between 0 and 1.
- "root_cause_category" is a short snake_case category (e.g. db_connection_pool_exhaustion).

Respond with ONLY a JSON array, no prose, in this exact shape:
[
  {"explanation": "...", "evidence_ids": ["LOG-1","INC-001"], "confidence": 0.0, "root_cause_category": "..."}
]`;

  let parsed: unknown = null;
  try {
    const res = await vigilAgent.generate(prompt);
    const text =
      typeof res === "string"
        ? res
        : ((res as { text?: string }).text ?? "");
    parsed = extractJsonArray(text);
  } catch (err) {
    console.error("[groundedRootCause] LLM call failed:", err);
  }

  const hypotheses = sanitizeHypotheses(parsed, allowedIds);

  // Demo-safety fallback: never return zero hypotheses.
  if (hypotheses.length === 0) {
    const fallbackEvidence = [
      chunks[0]?.ref,
      similarIncidents[0]?.incident_id,
    ].filter((x): x is string => Boolean(x));
    hypotheses.push({
      explanation:
        similarIncidents[0]?.summary ??
        `Likely ${signature.primary_error_pattern}. Automated analysis was unavailable; review the cited evidence directly.`,
      evidence_ids: fallbackEvidence,
      confidence: 0.3,
      root_cause_category:
        similarIncidents[0]?.root_cause_category ?? "unknown",
    });
  }

  return { hypotheses };
}

/** Validate/clean LLM output: enforce shape, drop hallucinated evidence ids. */
function sanitizeHypotheses(
  parsed: unknown,
  allowedIds: Set<string>
): RootCauseHypothesis[] {
  if (!Array.isArray(parsed)) return [];

  const out: RootCauseHypothesis[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const h = raw as Record<string, unknown>;

    const explanation = typeof h.explanation === "string" ? h.explanation : "";
    if (!explanation) continue;

    const evidence_ids = Array.isArray(h.evidence_ids)
      ? [...new Set(h.evidence_ids.map(String))].filter((id) =>
          allowedIds.has(id)
        )
      : [];

    let confidence =
      typeof h.confidence === "number" ? h.confidence : Number(h.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));

    const root_cause_category =
      typeof h.root_cause_category === "string" && h.root_cause_category
        ? h.root_cause_category
        : "unknown";

    out.push({ explanation, evidence_ids, confidence, root_cause_category });
  }

  // Rank by confidence (highest first); keep the top 3.
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 3);
}

/* ── Workflow assembly ───────────────────────────────────────────────────── */

export const ingestStep = createStep({
  id: "ingest-and-detect",
  description: "Chunk + embed logs, upsert to log_chunks, emit IncidentSignature.",
  inputSchema: incidentInputSchema,
  outputSchema: ingestOutputSchema,
  execute: async ({ inputData }) => ingestAndDetect(inputData),
});

export const retrieveStep = createStep({
  id: "retrieve-similar",
  description: "Hybrid-search similar past incidents and matching runbooks.",
  inputSchema: ingestOutputSchema,
  outputSchema: retrievalOutputSchema,
  execute: async ({ inputData }) => retrieveSimilar(inputData),
});

export const rootCauseStep = createStep({
  id: "grounded-root-cause",
  description: "Generate 3 ranked, evidence-cited root-cause hypotheses.",
  inputSchema: retrievalOutputSchema,
  outputSchema: rootCauseOutputSchema,
  execute: async ({ inputData }) => groundedRootCause(inputData),
});

export const incidentResponseWorkflow = createWorkflow({
  id: "incident-response",
  inputSchema: incidentInputSchema,
  outputSchema: rootCauseOutputSchema,
})
  .then(ingestStep)
  .then(retrieveStep)
  .then(rootCauseStep)
  .commit();

export type { RootCauseOutput };
