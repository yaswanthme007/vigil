"use client";

import { useState } from "react";
import { Card, BlastRadiusMeter, EnkryptBadge, ServiceBadge } from "./ui";
import { parseReason, blockedByText, type ReasonSource } from "./safety";
import type { RunState } from "./types";

/* — small line icons (no emoji) — */
function ProhibitIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="5.64" y1="5.64" x2="18.36" y2="18.36" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Source chip — POLICY (Vigil's own red rule) reads distinct from ENKRYPT
 *  (the external scanner, neutral/slate) so the room can see who blocked. */
function SourceTag({ source }: { source: ReasonSource }) {
  const styles =
    source === "POLICY"
      ? "border-red-500/40 bg-red-500/12 text-red-200"
      : source === "ENKRYPT"
        ? "border-white/25 bg-white/[0.06] text-white/85"
        : "border-white/15 bg-white/[0.04] text-white/55";
  const label = source === "OTHER" ? "SAFETY" : source;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${styles}`}
    >
      {label}
    </span>
  );
}

export function RemediationPanel({
  run,
  onDecision,
  onEscalate,
  busy,
}: {
  run: RunState;
  onDecision: (approved: boolean, rejectionReason?: string) => void;
  onEscalate: () => void;
  busy: boolean;
}) {
  const plan = run.remediation;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  if (!plan) {
    return (
      <Card title="Remediation" step={5}>
        <p className="text-sm text-white/40">
          {run.step >= 5 ? "Drafting remediation plan…" : "Awaiting root cause…"}
        </p>
      </Card>
    );
  }

  const blocked = !plan.safety.safe;
  // The engineer can act while the run is paused at Human Approval — whether it
  // passed the Safety Gate (awaiting_approval) or was blocked by it (blocked).
  const actionable =
    run.status === "awaiting_approval" || run.status === "blocked";
  const decided = run.status === "blocked" ? undefined : run.approval;

  /* The rejection editor is shared by both paths. */
  const rejectEditor = actionable && rejecting && (
    <div className="space-y-2 border-t border-white/10 pt-4">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for rejection…"
        rows={2}
        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/80 outline-none focus:border-white/30"
      />
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => onDecision(false, reason)}
          className="flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/75 transition-colors duration-150 ease-out hover:bg-white/[0.1] disabled:opacity-40"
        >
          Confirm Rejection
        </button>
        <button
          disabled={busy}
          onClick={() => setRejecting(false)}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/60 transition-colors duration-150 ease-out hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  /* ————————————————— BLOCKED: the hero moment ————————————————— */
  if (blocked) {
    return (
      <Card title="Proposed Remediation" step={5} accent="#fca5a5">
        <div className="space-y-5">
          {/* The seal owns the panel. */}
          <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] px-4 py-5">
            <div className="flex items-center gap-4">
              <ProhibitIcon className="h-10 w-10 shrink-0 text-red-400/90" />
              <div>
                <p className="text-2xl font-semibold leading-none tracking-[0.22em] text-red-300">
                  BLOCKED
                </p>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-red-300/55">
                  Enkrypt Safety Gate
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-red-500/20 pt-3 text-sm leading-relaxed text-red-100/85">
              {blockedByText(plan.safety.reasons)}
            </p>
          </div>

          {/* Why — reasons enumerated, each tagged by source. */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
              Why it was blocked
            </p>
            <ul className="space-y-1.5">
              {plan.safety.reasons.map((r, i) => {
                const { source, text } = parseReason(r);
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/75">
                    <SourceTag source={source} />
                    <span className="leading-relaxed">{text}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The dangerous fix, visibly neutralized and locked. */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-white/40">
              <LockIcon className="h-3.5 w-3.5" />
              <p className="text-xs uppercase tracking-wide">
                Refused fix — Vigil will not run this
              </p>
            </div>
            <ol className="space-y-1.5">
              {plan.steps.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-white/[0.012] px-2.5 py-1.5"
                >
                  <span className="mt-0.5 font-mono text-xs tabular-nums text-white/25 line-through">
                    {i + 1}.
                  </span>
                  <span className="flex-1 text-sm text-white/35 line-through decoration-white/25">
                    {s}
                  </span>
                  <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
                </li>
              ))}
            </ol>
          </div>

          <BlastRadiusMeter score={plan.blast_radius_score} />

          <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
            <span>Impacts:</span>
            {plan.affected_services.map((s) => (
              <ServiceBadge key={s} name={s} />
            ))}
          </div>

          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-white/40">
              Rollback
            </p>
            <p className="text-xs text-white/60">{plan.rollback_procedure}</p>
          </div>

          {/* Approve is absent by construction — only Reject / Escalate. */}
          {actionable && !rejecting && (
            <div className="flex gap-2 border-t border-white/10 pt-4">
              <button
                disabled={busy}
                onClick={() => setRejecting(true)}
                className="flex-1 rounded-lg border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:opacity-40"
              >
                Reject
              </button>
              <button
                disabled={busy}
                onClick={onEscalate}
                className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors duration-150 ease-out hover:bg-amber-500/25 disabled:opacity-40"
              >
                Escalate to human
              </button>
            </div>
          )}
          {rejectEditor}
        </div>
      </Card>
    );
  }

  /* ————————————————— SAFE: proposed remediation ————————————————— */
  return (
    <Card title="Proposed Remediation" step={5}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <EnkryptBadge
            kind="safe"
            label="Safety Gate — destructive-action policy + Enkrypt threat scan"
          />
          {plan.requires_approval && (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
              Approval required
            </span>
          )}
          {plan.source_runbook_ids.length > 0 && (
            <span className="text-xs text-white/40">
              from {plan.source_runbook_ids.join(", ")}
            </span>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
            Fix steps
          </p>
          <ol className="space-y-1.5">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-white/85">
                <span className="font-mono text-xs tabular-nums text-white/40">
                  {i + 1}.
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <BlastRadiusMeter score={plan.blast_radius_score} />

        <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
          <span>Impacts:</span>
          {plan.affected_services.map((s) => (
            <ServiceBadge key={s} name={s} />
          ))}
        </div>

        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-white/40">
            Rollback
          </p>
          <p className="text-xs text-white/60">{plan.rollback_procedure}</p>
        </div>

        {actionable && !rejecting && (
          <div className="flex gap-2 border-t border-white/10 pt-4">
            <button
              disabled={busy}
              onClick={() => onDecision(true)}
              className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors duration-150 ease-out hover:bg-emerald-500/25 disabled:opacity-40"
            >
              Approve &amp; Apply
            </button>
            <button
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="flex-1 rounded-lg border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition-colors duration-150 ease-out hover:bg-white/[0.08] disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        )}
        {rejectEditor}

        {decided && (
          <div className="border-t border-white/10 pt-3 text-sm">
            {decided.approved ? (
              <p className="text-emerald-300">
                ✓ Approved by {decided.engineer_id}
              </p>
            ) : (
              <p className="text-white/60">
                Rejected by {decided.engineer_id}
                {decided.rejection_reason ? ` — ${decided.rejection_reason}` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
