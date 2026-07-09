import type {
  IncidentSignature,
  LogChunk,
  SimilarIncident,
  MatchingRunbook,
  RootCauseHypothesis,
  SafetyCheckedPlan,
  PostmortemOutput,
  ApprovalDecision,
  Severity,
} from "@/mastra/types";

/** Client-side mirror of the engine's RunState (JSON shape from /api/status). */
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
  step: number;
  stepLabel: string;
  startedAt: number;
  updatedAt: number;
  mttrMinutes?: number;
  signature?: IncidentSignature;
  chunks?: LogChunk[];
  similarIncidents?: SimilarIncident[];
  matchingRunbooks?: MatchingRunbook[];
  hypotheses?: RootCauseHypothesis[];
  droppedHypotheses?: RootCauseHypothesis[];
  remediation?: SafetyCheckedPlan;
  approval?: ApprovalDecision;
  postmortem?: PostmortemOutput;
  error?: string;
}

export interface StatusResponse {
  run: RunState | null;
  memoryCount: number;
}

export const STEPS = [
  "Ingest & Detect",
  "Retrieve Similar",
  "Grounded Root Cause",
  "Grounding Gate",
  "Propose Remediation",
  "Safety Gate",
  "Human Approval",
  "Post-Mortem",
];
