import "../env";
import { z } from "zod";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { qdrant } from "../qdrant/client";
import { createAllCollections } from "../qdrant/collections";
import { embedDocument } from "../embeddings";
import { stableId } from "../ids";
import { vigilAgent } from "../agent";
import { searchIncidents } from "../tools/searchIncidents";
import { searchRunbooks } from "../tools/searchRunbooks";
import { estimateBlastRadius } from "../tools/estimateBlastRadius";
import { validateGrounding, checkDestructiveAction } from "../guardrails/enkrypt";
import {
  incidentInputSchema,
  ingestOutputSchema,
  retrievalOutputSchema,
  rootCauseOutputSchema,
  groundingGateOutputSchema,
  remediationPlanSchema,
  safetyCheckedPlanSchema,
  approvalSuspendSchema,
  approvalDecisionSchema,
  approvalOutputSchema,
  postmortemOutputSchema,
  type IncidentInput,
  type IngestOutput,
  type RetrievalOutput,
  type RootCauseOutput,
  type GroundingGateOutput,
  type RemediationPlan,
  type SafetyCheckedPlan,
  type ApprovalDecision,
  type PostmortemOutput,
  type SimilarIncident,
  type MatchingRunbook,
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
const runBlastRadius = estimateBlastRadius as unknown as ToolLike<
  {
    remediation: string;
    affected_services?: string[];
    risk_level?: "low" | "medium" | "high" | "critical";
  },
  {
    score: number;
    affected_services: string[];
    reversible: boolean;
    reasons: string[];
  }
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

/* ── Step 4: Enkrypt Grounding Gate ──────────────────────────────────────── */

export async function groundingGate(
  hypotheses: RootCauseHypothesis[]
): Promise<GroundingGateOutput> {
  const grounded = await validateGrounding(hypotheses);
  return { hypotheses: grounded, escalate: grounded.length === 0 };
}

/* ── Step 5: Propose Remediation ─────────────────────────────────────────── */

export async function proposeRemediation(args: {
  hypotheses: RootCauseHypothesis[];
  matchingRunbooks: MatchingRunbook[];
  signature: IncidentSignature;
  /** Preset the plan steps (skips the LLM) — used for deterministic demos. */
  overrideSteps?: string[];
  overrideRollback?: string;
}): Promise<RemediationPlan> {
  const { hypotheses, matchingRunbooks, signature } = args;
  const topRunbook = matchingRunbooks[0];

  const runbookContext = matchingRunbooks
    .map(
      (r) =>
        `[${r.runbook_id}] ${r.title} (risk=${r.risk_level}, requires_approval=${r.requires_approval})\n  steps: ${r.steps.join(" | ")}`
    )
    .join("\n");

  const hypothesisContext = hypotheses
    .map((h) => `- (${h.confidence.toFixed(2)}) ${h.explanation}`)
    .join("\n");

  const prompt = `You are Vigil's remediation planner. Draft a concrete remediation plan for the incident, grounded in the provided runbooks.

TOP ROOT-CAUSE HYPOTHESES:
${hypothesisContext || "(none)"}

AFFECTED SERVICES: ${signature.affected_services.join(", ")}

AVAILABLE RUNBOOKS:
${runbookContext || "(none)"}

RULES:
- Base the plan on the runbook steps above; do not invent unrelated actions.
- Prefer the safest procedure that resolves the root cause.
- Provide a clear rollback_procedure that undoes the plan.

Respond with ONLY a JSON object in this exact shape:
{"steps": ["...", "..."], "rollback_procedure": "..."}`;

  let steps: string[] = [];
  let rollback_procedure = "";

  if (args.overrideSteps && args.overrideSteps.length > 0) {
    // Deterministic path (demo scenarios) — skip the LLM entirely.
    steps = [...args.overrideSteps];
    rollback_procedure = args.overrideRollback ?? "";
  } else {
    try {
      const res = await vigilAgent.generate(prompt);
      const text =
        typeof res === "string" ? res : ((res as { text?: string }).text ?? "");
      const parsed = extractJsonObject(text) as {
        steps?: unknown;
        rollback_procedure?: unknown;
      } | null;
      if (parsed) {
        if (Array.isArray(parsed.steps)) {
          steps = parsed.steps.map(String).filter((s) => s.trim().length > 0);
        }
        if (typeof parsed.rollback_procedure === "string") {
          rollback_procedure = parsed.rollback_procedure;
        }
      }
    } catch (err) {
      console.error("[proposeRemediation] LLM call failed:", err);
    }
  }

  // Fallback: use the top runbook's steps verbatim so we never emit an empty plan.
  if (steps.length === 0 && topRunbook) {
    steps = [...topRunbook.steps];
  }
  if (!rollback_procedure) {
    rollback_procedure = topRunbook
      ? `Revert the changes from runbook ${topRunbook.runbook_id} ("${topRunbook.title}") and restore the previous configuration.`
      : "No rollback procedure available — manual review required.";
  }

  const riskLevel = topRunbook?.risk_level as
    | "low"
    | "medium"
    | "high"
    | "critical"
    | undefined;

  const blast = await runBlastRadius.execute({
    context: {
      remediation: `${steps.join("\n")}\n${rollback_procedure}`,
      affected_services: signature.affected_services,
      risk_level:
        riskLevel && ["low", "medium", "high", "critical"].includes(riskLevel)
          ? riskLevel
          : undefined,
    },
  });

  const usingOverride = Boolean(
    args.overrideSteps && args.overrideSteps.length > 0
  );
  // Override plans are operator-proposed emergency actions, not runbook-derived.
  const requires_approval =
    usingOverride || matchingRunbooks.some((r) => r.requires_approval);

  return {
    steps,
    blast_radius_score: blast.score,
    affected_services:
      blast.affected_services.length > 0
        ? blast.affected_services
        : signature.affected_services,
    rollback_procedure,
    requires_approval,
    source_runbook_ids: usingOverride
      ? []
      : matchingRunbooks.map((r) => r.runbook_id),
  };
}

/** Pull the first balanced JSON object out of a possibly noisy LLM response. */
function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ── Step 6: Enkrypt Safety Gate ─────────────────────────────────────────── */

export async function safetyGate(
  plan: RemediationPlan
): Promise<SafetyCheckedPlan> {
  const planText = `${plan.steps.join("\n")}\n${plan.rollback_procedure}`;
  const check = await checkDestructiveAction(planText);

  // Force human approval when unsafe or when impact is meaningful (>= 40).
  const requires_approval =
    plan.requires_approval || !check.safe || plan.blast_radius_score >= 40;

  return {
    ...plan,
    requires_approval,
    safety: {
      safe: check.safe,
      reasons: check.reasons,
      blast_radius: check.blast_radius,
    },
  };
}

/* ── Step 8: Generate Post-Mortem (the flywheel) ─────────────────────────── */

export async function generatePostmortem(ctx: {
  signature: IncidentSignature;
  hypotheses: RootCauseHypothesis[];
  plan: SafetyCheckedPlan;
  decision: ApprovalDecision;
  similarIncidents?: SimilarIncident[];
  mttrMinutes?: number;
}): Promise<PostmortemOutput> {
  const { signature, hypotheses, plan, decision } = ctx;
  const topHypothesis = hypotheses[0];
  const rootCauseCategory = topHypothesis?.root_cause_category ?? "unknown";
  const postmortem_id = `PM-${signature.incidentId}`;
  const mttrMinutes = ctx.mttrMinutes ?? 30;
  const nowIso = new Date().toISOString();

  const priorContext = (ctx.similarIncidents ?? [])
    .slice(0, 3)
    .map(
      (s) =>
        `- ${s.incident_id} (${s.root_cause_category}): ${s.remediation_applied}`
    )
    .join("\n");

  const prompt = `You are Vigil's post-mortem writer. Produce a professional, blameless incident post-mortem in Markdown with EXACTLY these sections (use "## " headings):
Incident Summary, Timeline, Root Cause Analysis, Remediation Applied, What Worked / What Didn't, Follow-up Action Items, Prevention Recommendations.

INCIDENT
- id: ${signature.incidentId}
- services: ${signature.affected_services.join(", ")}
- severity: ${signature.severity}
- primary error: ${signature.primary_error_pattern}
- detected at: ${signature.anomaly_start_timestamp ?? "unknown"}
- time to resolve: ~${mttrMinutes} minutes

ROOT-CAUSE HYPOTHESES (ranked):
${hypotheses.map((h) => `- (${h.confidence.toFixed(2)}) [${h.root_cause_category}] ${h.explanation}`).join("\n") || "(none)"}

REMEDIATION APPLIED (approved by ${decision.engineer_id}):
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Rollback: ${plan.rollback_procedure}
Blast radius: ${plan.blast_radius_score}/100. Safety: ${plan.safety.safe ? "clean" : plan.safety.reasons.join("; ")}

SIMILAR PAST INCIDENTS:
${priorContext || "(none)"}

Respond with ONLY a JSON object in this exact shape (the markdown goes in "postmortem_markdown"):
{"postmortem_markdown": "## Incident Summary\\n...", "action_items": ["..."], "prevention_recommendations": ["..."]}`;

  let markdown = "";
  let action_items: string[] = [];
  let prevention_recommendations: string[] = [];

  try {
    const res = await vigilAgent.generate(prompt);
    const text =
      typeof res === "string" ? res : ((res as { text?: string }).text ?? "");
    const parsed = extractJsonObject(text) as {
      postmortem_markdown?: unknown;
      action_items?: unknown;
      prevention_recommendations?: unknown;
    } | null;
    if (parsed) {
      if (typeof parsed.postmortem_markdown === "string") {
        markdown = parsed.postmortem_markdown;
      }
      if (Array.isArray(parsed.action_items)) {
        action_items = parsed.action_items.map(String);
      }
      if (Array.isArray(parsed.prevention_recommendations)) {
        prevention_recommendations =
          parsed.prevention_recommendations.map(String);
      }
    }
  } catch (err) {
    console.error("[generatePostmortem] LLM call failed:", err);
  }

  // Fallback so a post-mortem is always produced, even if the LLM is down.
  if (!markdown) {
    markdown = fallbackPostmortem({
      signature,
      hypotheses,
      plan,
      decision,
      mttrMinutes,
    });
    if (action_items.length === 0) {
      action_items = [
        `Add alerting for "${signature.primary_error_pattern}" before it escalates.`,
        `Document the applied remediation in the ${rootCauseCategory} runbook.`,
      ];
    }
    if (prevention_recommendations.length === 0) {
      prevention_recommendations = [
        `Load-test ${signature.affected_services[0] ?? "the affected service"} against this failure mode.`,
      ];
    }
  }

  const quality_score = scorePostmortem({
    markdown,
    action_items,
    prevention_recommendations,
    hypotheses,
  });

  // Write the post-mortem to Qdrant.
  const summary = `${signature.primary_error_pattern} affecting ${signature.affected_services.join(", ")}. Root cause: ${rootCauseCategory}. Resolved by: ${plan.steps[0] ?? "remediation"}.`;

  const postmortemVector = await embedDocument(`${summary}\n\n${markdown}`);
  await qdrant.upsert("postmortems", {
    wait: true,
    points: [
      {
        id: stableId(postmortem_id),
        vector: { content_embedding: postmortemVector },
        payload: {
          postmortem_id,
          incident_id: signature.incidentId,
          full_text: markdown,
          action_items,
          prevention_recommendations,
          created_at: nowIso,
          quality_score,
        },
      },
    ],
  });

  // FLYWHEEL: upsert the resolved incident back into memory so future
  // retrievals find it. This is what makes the memory counter climb and
  // subsequent similar incidents resolve with higher confidence.
  const incidentVector = await embedDocument(summary);
  await qdrant.upsert("incidents", {
    wait: true,
    points: [
      {
        id: stableId(signature.incidentId),
        vector: { summary_embedding: incidentVector },
        payload: {
          incident_id: signature.incidentId,
          summary,
          services_affected: signature.affected_services,
          symptoms: [signature.primary_error_pattern],
          root_cause_category: rootCauseCategory,
          remediation_applied: plan.steps.join(" "),
          remediation_worked: true,
          mttr_minutes: mttrMinutes,
          severity: signature.severity,
          created_at: nowIso,
          postmortem_id,
        },
      },
    ],
  });

  return {
    postmortem_id,
    postmortem_text: markdown,
    incident_updated: true,
    action_items,
    prevention_recommendations,
    quality_score,
  };
}

/** Deterministic post-mortem used when the LLM is unavailable. */
function fallbackPostmortem(ctx: {
  signature: IncidentSignature;
  hypotheses: RootCauseHypothesis[];
  plan: SafetyCheckedPlan;
  decision: ApprovalDecision;
  mttrMinutes: number;
}): string {
  const { signature, hypotheses, plan, decision, mttrMinutes } = ctx;
  const top = hypotheses[0];
  return [
    `## Incident Summary`,
    `${signature.severity} incident on ${signature.affected_services.join(", ")}: ${signature.primary_error_pattern}. Resolved in ~${mttrMinutes} minutes.`,
    ``,
    `## Timeline`,
    `- ${signature.anomaly_start_timestamp ?? "T0"} — anomaly detected (${signature.raw_log_count} log lines ingested).`,
    `- Root cause identified and remediation approved by ${decision.engineer_id}.`,
    ``,
    `## Root Cause Analysis`,
    top
      ? `${top.explanation} (category: ${top.root_cause_category}, confidence ${top.confidence.toFixed(2)}).`
      : `Root cause could not be determined automatically.`,
    ``,
    `## Remediation Applied`,
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## What Worked / What Didn't`,
    `The remediation passed Vigil's safety checks (blast radius ${plan.blast_radius_score}/100) and resolved the incident.`,
    ``,
    `## Follow-up Action Items`,
    `- Review alerting coverage for this failure mode.`,
    ``,
    `## Prevention Recommendations`,
    `- Harden ${signature.affected_services[0] ?? "the affected service"} against recurrence.`,
  ].join("\n");
}

/** Heuristic post-mortem quality score (0-100). */
function scorePostmortem(ctx: {
  markdown: string;
  action_items: string[];
  prevention_recommendations: string[];
  hypotheses: RootCauseHypothesis[];
}): number {
  let score = 55;
  const sections = (ctx.markdown.match(/^##\s/gm) ?? []).length;
  score += Math.min(sections, 7) * 3; // up to +21 for the 7 sections
  if (ctx.action_items.length >= 2) score += 8;
  if (ctx.prevention_recommendations.length >= 1) score += 8;
  if (ctx.hypotheses.some((h) => h.evidence_ids.length > 0)) score += 8;
  return Math.min(100, Math.round(score));
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

export const groundingGateStep = createStep({
  id: "enkrypt-grounding-gate",
  description:
    "Enkrypt Grounding Gate: keep only grounded hypotheses; escalate if none pass.",
  inputSchema: rootCauseOutputSchema,
  outputSchema: groundingGateOutputSchema,
  suspendSchema: z.object({
    escalate: z.literal(true),
    reason: z.string(),
  }),
  execute: async ({ inputData, suspend }) => {
    const result = await groundingGate(inputData.hypotheses);
    if (result.escalate) {
      // No grounded root cause — hand off to a human instead of guessing.
      await suspend({
        escalate: true,
        reason:
          "No root-cause hypothesis passed the Enkrypt Grounding Gate. Human investigation required.",
      });
    }
    return result;
  },
});

export const proposeRemediationStep = createStep({
  id: "propose-remediation",
  description:
    "Draft a runbook-grounded remediation plan and estimate its blast radius.",
  inputSchema: groundingGateOutputSchema,
  outputSchema: remediationPlanSchema,
  execute: async ({ inputData, getStepResult, getInitData }) => {
    const retrieval = getStepResult(retrieveStep);
    // Honour the demo override (Scenario B) threaded through the workflow input,
    // so the deterministic destructive plan still reaches the Safety Gate.
    const init = getInitData() as {
      overrideSteps?: string[];
      overrideRollback?: string;
    };
    return proposeRemediation({
      hypotheses: inputData.hypotheses,
      matchingRunbooks: retrieval.matchingRunbooks,
      signature: retrieval.signature,
      overrideSteps: init?.overrideSteps,
      overrideRollback: init?.overrideRollback,
    });
  },
});

export const safetyGateStep = createStep({
  id: "enkrypt-safety-gate",
  description:
    "Enkrypt Safety Gate: block destructive actions and force approval on risky plans.",
  inputSchema: remediationPlanSchema,
  outputSchema: safetyCheckedPlanSchema,
  execute: async ({ inputData }) => safetyGate(inputData),
});

export const approvalStep = createStep({
  id: "human-approval",
  description:
    "Suspend for a human engineer to approve or reject the remediation plan.",
  inputSchema: safetyCheckedPlanSchema,
  suspendSchema: approvalSuspendSchema,
  resumeSchema: approvalDecisionSchema,
  outputSchema: approvalOutputSchema,
  execute: async ({ inputData, resumeData, suspend, getStepResult }) => {
    if (!resumeData) {
      const grounding = getStepResult(groundingGateStep);
      await suspend({
        remediation_plan: inputData,
        safety_status: inputData.safety,
        grounded_hypotheses: grounding.hypotheses,
      });
      // Not reached until resumed; return a placeholder to satisfy typing.
      return {
        plan: inputData,
        decision: { approved: false, engineer_id: "pending" },
      };
    }
    return { plan: inputData, decision: resumeData };
  },
});

export const postmortemStep = createStep({
  id: "generate-postmortem",
  description:
    "On approval, generate the post-mortem and upsert the resolved incident (flywheel).",
  inputSchema: approvalOutputSchema,
  outputSchema: postmortemOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const { plan, decision } = inputData;

    if (!decision.approved) {
      // Rejected — terminate without writing a post-mortem.
      return {
        postmortem_id: "",
        postmortem_text: `Remediation rejected by ${decision.engineer_id}. Reason: ${decision.rejection_reason ?? "not specified"}.`,
        incident_updated: false,
        action_items: [],
        prevention_recommendations: [],
        quality_score: 0,
      };
    }

    const retrieval = getStepResult(retrieveStep);
    const grounding = getStepResult(groundingGateStep);
    return generatePostmortem({
      signature: retrieval.signature,
      hypotheses: grounding.hypotheses,
      plan,
      decision,
      similarIncidents: retrieval.similarIncidents,
    });
  },
});

export const incidentResponseWorkflow = createWorkflow({
  id: "incident-response",
  inputSchema: incidentInputSchema,
  outputSchema: postmortemOutputSchema,
})
  .then(ingestStep)
  .then(retrieveStep)
  .then(rootCauseStep)
  .then(groundingGateStep)
  .then(proposeRemediationStep)
  .then(safetyGateStep)
  .then(approvalStep)
  .then(postmortemStep)
  .commit();

export type {
  RootCauseOutput,
  RemediationPlan,
  SafetyCheckedPlan,
  PostmortemOutput,
};
