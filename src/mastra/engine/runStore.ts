import "../env";
import { randomUUID } from "crypto";
import { qdrant } from "../qdrant/client";
import { mastra } from "../index";
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
 * Run engine for the live dashboard. This DRIVES the real Mastra
 * `incidentResponseWorkflow` (createRunAsync → start → resume) and mirrors its
 * per-step progress into a RunState the UI polls. Mastra `watch()` events give
 * live step transitions and each step's output; the workflow suspends at the
 * Human-Approval step (Mastra suspend/resume, backed by the InMemoryStore
 * configured on the Mastra instance) and we resume it on the engineer's
 * decision. The pure step functions still exist — the workflow's steps call
 * them — but orchestration is now Mastra's, not hand-rolled.
 *
 * State (and the live Mastra run handles) live on globalThis so they survive
 * Next.js dev hot-reloads within the single long-lived server process.
 */

export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "blocked" // Safety Gate flagged the plan unsafe — structurally unapprovable.
  | "generating_postmortem"
  | "completed"
  | "rejected"
  | "escalated"
  | "error";

/** Result of an approval attempt. `refused` = the Safety Gate blocked approval. */
export interface ApprovalResult {
  run: RunState | null;
  refused: boolean;
  message?: string;
}

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

/** Workflow step id → dashboard step number. */
const STEP_NUM: Record<string, number> = {
  "ingest-and-detect": 1,
  "retrieve-similar": 2,
  "grounded-root-cause": 3,
  "enkrypt-grounding-gate": 4,
  "propose-remediation": 5,
  "enkrypt-safety-gate": 6,
  "human-approval": 7,
  "generate-postmortem": 8,
};

/* ── Minimal structural types for the Mastra workflow run ─────────────────── */

interface WfStepResult {
  status?: string;
  output?: unknown;
  suspendPayload?: unknown;
}
interface WfResult {
  status: "success" | "suspended" | "failed";
  steps: Record<string, WfStepResult>;
  suspended?: string[][];
  result?: unknown;
  error?: { message?: string } | Error;
}
interface WfRun {
  runId: string;
  watch(cb: (event: unknown) => void, type: "watch"): () => void;
  start(args: { inputData: unknown }): Promise<WfResult>;
  resume(args: { step: string | string[]; resumeData: unknown }): Promise<WfResult>;
}

interface Handle {
  run: WfRun;
  unwatch?: () => void;
  allHypotheses: RootCauseHypothesis[]; // captured at root-cause for dropped calc
}

interface GlobalStore {
  runs: Map<string, RunState>;
  handles: Map<string, Handle>;
}

function store(): GlobalStore {
  const g = globalThis as unknown as { __vigil?: GlobalStore };
  if (!g.__vigil) {
    g.__vigil = { runs: new Map(), handles: new Map() };
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

/** Copy a completed step's output into the RunState the UI renders. */
function applyStepOutput(
  run: RunState,
  handle: Handle,
  stepId: string,
  output: unknown
) {
  if (!output || typeof output !== "object") return;
  const o = output as Record<string, unknown>;
  switch (stepId) {
    case "ingest-and-detect": {
      if (o.signature) {
        run.signature = o.signature as IncidentSignature;
        run.severity = (o.signature as IncidentSignature).severity;
      }
      if (o.chunks) run.chunks = o.chunks as LogChunk[];
      break;
    }
    case "retrieve-similar": {
      if (o.similarIncidents)
        run.similarIncidents = o.similarIncidents as SimilarIncident[];
      if (o.matchingRunbooks)
        run.matchingRunbooks = o.matchingRunbooks as MatchingRunbook[];
      break;
    }
    case "grounded-root-cause": {
      if (Array.isArray(o.hypotheses))
        handle.allHypotheses = o.hypotheses as RootCauseHypothesis[];
      break;
    }
    case "enkrypt-grounding-gate": {
      if (Array.isArray(o.hypotheses)) {
        const grounded = o.hypotheses as RootCauseHypothesis[];
        run.hypotheses = grounded;
        run.droppedHypotheses = handle.allHypotheses.filter(
          (h) => !grounded.includes(h)
        );
      }
      break;
    }
    case "enkrypt-safety-gate": {
      // The SafetyCheckedPlan (has .safety) — what the Remediation panel needs.
      run.remediation = output as SafetyCheckedPlan;
      break;
    }
    case "generate-postmortem": {
      run.postmortem = output as PostmortemOutput;
      break;
    }
  }
}

/** Kick off a run: create the Mastra workflow run and drive it. */
export async function startRun(
  input: IncidentInput,
  opts: StartOptions = {}
): Promise<RunState> {
  const incidentId =
    opts.incidentId ??
    `INC-LIVE-${(opts.scenario ?? "X").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const wf = mastra.getWorkflow("incidentResponseWorkflow");
  const wfRun = (await wf.createRunAsync()) as unknown as WfRun;
  const runId = wfRun.runId ?? randomUUID();

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

  const handle: Handle = { run: wfRun, allHypotheses: [] };
  store().runs.set(runId, run);
  store().handles.set(runId, handle);

  // Live progress: advance the step and capture each step's output as the
  // workflow runs. Status is managed at the await boundaries below, not here,
  // so progress never fights the terminal transitions.
  handle.unwatch = wfRun.watch((event: unknown) => {
    const e = event as {
      payload?: { currentStep?: { id?: string; status?: string; output?: unknown } };
    };
    const cs = e.payload?.currentStep;
    if (!cs?.id) return;
    const n = STEP_NUM[cs.id];
    if (!n) return;
    if (n >= run.step && run.status === "running") {
      run.step = n;
      run.stepLabel = STEP_LABELS[n] ?? run.stepLabel;
      run.updatedAt = Date.now();
    }
    if (cs.status === "success") applyStepOutput(run, handle, cs.id, cs.output);
  }, "watch");

  // Fire-and-forget: the workflow runs to the approval suspension; the dashboard
  // polls getRun() meanwhile.
  void wfRun
    .start({
      inputData: {
        incidentId,
        alert: input.alert,
        rawLogs: input.rawLogs,
        overrideSteps: opts.overrideSteps,
        overrideRollback: opts.overrideRollback,
      },
    })
    .then((result) => onStartResolved(runId, result))
    .catch((err) => {
      const r = store().runs.get(runId);
      if (r) {
        r.status = "error";
        r.error = err instanceof Error ? err.message : String(err);
        r.updatedAt = Date.now();
      }
      console.error(`[engine] workflow ${runId} start failed:`, err);
    });

  return run;
}

/** Reconcile RunState with the WorkflowResult once start() settles. */
function onStartResolved(runId: string, result: WfResult) {
  const run = store().runs.get(runId);
  const handle = store().handles.get(runId);
  if (!run || !handle) return;

  // Backfill any outputs (belt and braces — watch already streamed most).
  for (const [stepId, sr] of Object.entries(result.steps ?? {})) {
    if (sr?.status === "success" && sr.output !== undefined) {
      applyStepOutput(run, handle, stepId, sr.output);
    }
  }

  if (result.status === "failed") {
    const msg =
      (result.error as { message?: string })?.message ?? "workflow failed";
    run.error = msg;
    touch(run, run.step, "error");
    handle.unwatch?.();
    return;
  }

  if (result.status === "suspended") {
    const suspendedStep = result.suspended?.[0]?.[0];
    if (suspendedStep === "enkrypt-grounding-gate") {
      // No grounded root cause — escalate to a human (Vigil will not guess).
      run.hypotheses = [];
      run.droppedHypotheses = handle.allHypotheses;
      touch(run, 4, "escalated");
      handle.unwatch?.();
      return;
    }
    // Suspended at Human Approval. If the Safety Gate flagged the plan unsafe,
    // it is structurally unapprovable → 'blocked'; otherwise 'awaiting_approval'.
    const unsafe = run.remediation?.safety.safe === false;
    touch(run, 7, unsafe ? "blocked" : "awaiting_approval");
    return;
  }

  // Unexpected: workflow completed on first start (no approval step). Treat as
  // completed if we got a post-mortem.
  if (result.status === "success") {
    run.postmortem = result.result as PostmortemOutput;
    touch(run, 8, "completed");
    handle.unwatch?.();
  }
}

/** Resume the suspended run with the engineer's decision (drives step 8). */
export function submitApproval(
  runId: string,
  decision: ApprovalDecision
): ApprovalResult {
  const run = store().runs.get(runId);
  const handle = store().handles.get(runId);
  if (!run || !handle) return { run: run ?? null, refused: false };

  if (run.status !== "awaiting_approval" && run.status !== "blocked") {
    return { run, refused: false };
  }

  const unsafe = run.remediation?.safety.safe === false;

  // HARD SAFETY INVARIANT: a plan the Safety Gate flagged unsafe can NEVER be
  // approved — not via the UI, not via a direct API call. No post-mortem is
  // written and the incident is never upserted. The engineer must reject or
  // escalate. This is the structural guarantee behind Vigil's pitch.
  if (decision.approved && unsafe) {
    touch(run, 7, "blocked");
    return {
      run,
      refused: true,
      message:
        "Approval refused: the Enkrypt Safety Gate blocked this remediation as destructive. It cannot be approved — reject or escalate to a human.",
    };
  }

  run.approval = decision;
  run.mttrMinutes = elapsedMinutes(run);

  if (!decision.approved) {
    // Reject: freeze the mirror at 'rejected' immediately, then resume the
    // workflow in the background so its state settles (the post-mortem step
    // returns a rejection record and does NOT upsert the incident).
    handle.unwatch?.();
    touch(run, 7, "rejected");
    void resumeWorkflow(handle, decision).catch((err) =>
      console.error(`[engine] resume(reject) ${runId} failed:`, err)
    );
    return { run, refused: false };
  }

  // Approve (and safe): resume; the post-mortem step writes the report and
  // upserts the resolved incident (the flywheel).
  touch(run, 8, "generating_postmortem");
  void (async () => {
    try {
      const result = await resumeWorkflow(handle, decision);
      if (result.status === "success") {
        run.postmortem = result.result as PostmortemOutput;
        touch(run, 8, "completed");
      } else if (result.status === "failed") {
        run.error =
          (result.error as { message?: string })?.message ?? "postmortem failed";
        touch(run, 8, "error");
      }
      handle.unwatch?.();
    } catch (err) {
      run.status = "error";
      run.error = err instanceof Error ? err.message : String(err);
      run.updatedAt = Date.now();
      console.error(`[engine] resume(approve) ${runId} failed:`, err);
    }
  })();

  return { run, refused: false };
}

/**
 * Escalate a paused run to a human instead of approving/rejecting. Valid from
 * awaiting_approval or blocked. Writes no post-mortem and never upserts.
 */
export function escalateRun(
  runId: string,
  engineerId = "on-call-engineer"
): RunState | null {
  const run = store().runs.get(runId);
  const handle = store().handles.get(runId);
  if (!run) return null;
  if (run.status !== "awaiting_approval" && run.status !== "blocked") return run;

  const decision: ApprovalDecision = {
    approved: false,
    rejection_reason:
      "Escalated to a human engineer — Safety Gate blocked a destructive remediation.",
    engineer_id: engineerId,
  };
  run.approval = decision;
  run.mttrMinutes = elapsedMinutes(run);
  handle?.unwatch?.();
  touch(run, 7, "escalated");
  if (handle) {
    void resumeWorkflow(handle, decision).catch((err) =>
      console.error(`[engine] resume(escalate) ${runId} failed:`, err)
    );
  }
  return run;
}

/** Resume the underlying Mastra workflow at the Human-Approval step. */
function resumeWorkflow(
  handle: Handle,
  decision: ApprovalDecision
): Promise<WfResult> {
  return handle.run.resume({ step: "human-approval", resumeData: decision });
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
