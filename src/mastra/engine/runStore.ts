import "../env";
import { randomUUID } from "crypto";
import { qdrant } from "../qdrant/client";
import {
  ingestAndDetect,
  retrieveSimilar,
  groundedRootCause,
  groundingGate,
  proposeRemediation,
  safetyGate,
  generatePostmortem,
} from "../workflows/incidentResponse";
import type {
  IncidentInput,
  IncidentSignature,
  LogChunk,
  SimilarIncident,
  MatchingRunbook,
  RootCauseHypothesis,
  SafetyCheckedPlan,
  PostmortemOutput,
  ApprovalDecision,
  Severity,
} from "../types";

/**
 * In-memory run engine that drives the incident-response pipeline for the live
 * dashboard. It calls the SAME pure step functions as the Mastra
 * incidentResponseWorkflow, but exposes per-step state so the UI can poll and
 * render progress, and pauses at Human Approval until the engineer decides.
 *
 * State is kept on globalThis so it survives Next.js dev hot-reloads within the
 * same server process.
 */

export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "generating_postmortem"
  | "completed"
  | "rejected"
  | "escalated"
  | "error";

export interface RunState {
  runId: string;
  incidentId: string;
  scenario: string | null;
  title: string;
  severity: Severity;
  status: RunStatus;
  step: number; // 1..8
  stepLabel: string;
  startedAt: number;
  updatedAt: number;
  mttrMinutes?: number;
  signature?: IncidentSignature;
  chunks?: LogChunk[];
  similarIncidents?: SimilarIncident[];
  matchingRunbooks?: MatchingRunbook[];
  hypotheses?: RootCauseHypothesis[]; // grounded (post-gate)
  droppedHypotheses?: RootCauseHypothesis[]; // failed the grounding gate
  remediation?: SafetyCheckedPlan;
  approval?: ApprovalDecision;
  postmortem?: PostmortemOutput;
  error?: string;
}

interface StartOptions {
  incidentId?: string;
  scenario?: string | null;
  overrideSteps?: string[];
  overrideRollback?: string;
}

const STEP_LABELS: Record<number, string> = {
  1: "Ingest & Detect",
  2: "Retrieve Similar",
  3: "Grounded Root Cause",
  4: "Enkrypt Grounding Gate",
  5: "Propose Remediation",
  6: "Enkrypt Safety Gate",
  7: "Human Approval",
  8: "Generate Post-Mortem",
};

interface GlobalStore {
  runs: Map<string, RunState>;
  /** overrides captured at start, consumed after approval for step 5. */
  overrides: Map<string, { steps?: string[]; rollback?: string }>;
}

function store(): GlobalStore {
  const g = globalThis as unknown as { __vigil?: GlobalStore };
  if (!g.__vigil) {
    g.__vigil = { runs: new Map(), overrides: new Map() };
  }
  return g.__vigil;
}

function touch(run: RunState, step: number, status: RunStatus) {
  run.step = step;
  run.stepLabel = STEP_LABELS[step] ?? run.stepLabel;
  run.status = status;
  run.updatedAt = Date.now();
}

function elapsedMinutes(run: RunState): number {
  return Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
}

/** Kick off a run. Returns immediately; steps 1-6 execute in the background. */
export function startRun(input: IncidentInput, opts: StartOptions = {}): RunState {
  const runId = randomUUID();
  const incidentId =
    opts.incidentId ??
    `INC-LIVE-${(opts.scenario ?? "X").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const run: RunState = {
    runId,
    incidentId,
    scenario: opts.scenario ?? null,
    title: input.alert.title,
    severity: input.alert.severity ?? "P3",
    status: "running",
    step: 1,
    stepLabel: STEP_LABELS[1],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  store().runs.set(runId, run);
  store().overrides.set(runId, {
    steps: opts.overrideSteps,
    rollback: opts.overrideRollback,
  });

  // Fire and forget — the dashboard polls getRun() for progress.
  void executePipeline(runId, { ...input, incidentId }).catch((err) => {
    const r = store().runs.get(runId);
    if (r) {
      r.status = "error";
      r.error = err instanceof Error ? err.message : String(err);
      r.updatedAt = Date.now();
    }
    console.error(`[engine] run ${runId} failed:`, err);
  });

  return run;
}

/** Steps 1-6, then pause at Human Approval (step 7). */
async function executePipeline(runId: string, input: IncidentInput) {
  const run = store().runs.get(runId)!;

  touch(run, 1, "running");
  const ingest = await ingestAndDetect(input);
  run.signature = ingest.signature;
  run.chunks = ingest.chunks;
  run.severity = ingest.signature.severity;

  touch(run, 2, "running");
  const retrieval = await retrieveSimilar(ingest);
  run.similarIncidents = retrieval.similarIncidents;
  run.matchingRunbooks = retrieval.matchingRunbooks;

  touch(run, 3, "running");
  const rc = await groundedRootCause(retrieval);

  touch(run, 4, "running");
  const gate = await groundingGate(rc.hypotheses);
  run.hypotheses = gate.hypotheses;
  run.droppedHypotheses = rc.hypotheses.filter(
    (h) => !gate.hypotheses.includes(h)
  );

  if (gate.escalate) {
    touch(run, 4, "escalated");
    return; // No grounded root cause — escalate to a human, stop here.
  }

  touch(run, 5, "running");
  const override = store().overrides.get(runId);
  const plan = await proposeRemediation({
    hypotheses: gate.hypotheses,
    matchingRunbooks: retrieval.matchingRunbooks,
    signature: retrieval.signature,
    overrideSteps: override?.steps,
    overrideRollback: override?.rollback,
  });

  touch(run, 6, "running");
  const checked = await safetyGate(plan);
  run.remediation = checked;

  // Step 7 — wait for the engineer.
  touch(run, 7, "awaiting_approval");
}

/** Resume a suspended run with the engineer's decision (drives step 8). */
export function submitApproval(
  runId: string,
  decision: ApprovalDecision
): RunState | null {
  const run = store().runs.get(runId);
  if (!run) return null;
  if (run.status !== "awaiting_approval") return run;

  run.approval = decision;
  run.mttrMinutes = elapsedMinutes(run);

  if (!decision.approved) {
    touch(run, 7, "rejected");
    return run;
  }

  touch(run, 8, "generating_postmortem");

  // Generate the post-mortem in the background; polling reveals it when ready.
  void (async () => {
    try {
      const pm = await generatePostmortem({
        signature: run.signature!,
        hypotheses: run.hypotheses ?? [],
        plan: run.remediation!,
        decision,
        similarIncidents: run.similarIncidents,
        mttrMinutes: run.mttrMinutes,
      });
      run.postmortem = pm;
      touch(run, 8, "completed");
    } catch (err) {
      run.status = "error";
      run.error = err instanceof Error ? err.message : String(err);
      run.updatedAt = Date.now();
      console.error(`[engine] postmortem for ${runId} failed:`, err);
    }
  })();

  return run;
}

export function getRun(runId: string): RunState | null {
  return store().runs.get(runId) ?? null;
}

export function latestRun(): RunState | null {
  let latest: RunState | null = null;
  for (const r of store().runs.values()) {
    if (!latest || r.startedAt > latest.startedAt) latest = r;
  }
  return latest;
}

/** Memory counter — number of incidents currently in Qdrant. */
export async function getMemoryCount(): Promise<number> {
  try {
    const res = await qdrant.count("incidents", { exact: true });
    return res.count;
  } catch {
    return 0;
  }
}
