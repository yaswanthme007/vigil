"use client";

import { useState } from "react";
import { Card, BlastRadiusMeter, EnkryptBadge, ServiceBadge } from "./ui";
import type { RunState } from "./types";

export function RemediationPanel({
  run,
  onDecision,
  busy,
}: {
  run: RunState;
  onDecision: (approved: boolean, rejectionReason?: string) => void;
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
  const awaiting = run.status === "awaiting_approval";
  const decided = run.approval;

  return (
    <Card title="Proposed Remediation" step={5} accent={blocked ? "#fca5a5" : undefined}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {blocked ? (
            <EnkryptBadge kind="blocked" label="Destructive Action Blocked" />
          ) : (
            <EnkryptBadge kind="safe" label="Safety Checked" />
          )}
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

        {blocked && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-300">
              Enkrypt Safety Gate — reasons
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-red-200/90">
              {plan.safety.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
            Fix steps
          </p>
          <ol className="space-y-1.5">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-white/85">
                <span className="font-mono text-xs text-white/40">{i + 1}.</span>
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

        {/* Decision area */}
        {awaiting && plan.requires_approval && !rejecting && (
          <div className="flex gap-2 border-t border-white/10 pt-4">
            <button
              disabled={busy}
              onClick={() => onDecision(true)}
              className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-40"
            >
              Approve &amp; Apply
            </button>
            <button
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="flex-1 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        )}

        {awaiting && rejecting && (
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
                className="flex-1 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"
              >
                Confirm Rejection
              </button>
              <button
                disabled={busy}
                onClick={() => setRejecting(false)}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/60 transition hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {decided && (
          <div className="border-t border-white/10 pt-3 text-sm">
            {decided.approved ? (
              <p className="text-emerald-300">
                ✓ Approved by {decided.engineer_id}
              </p>
            ) : (
              <p className="text-red-300">
                ✕ Rejected by {decided.engineer_id}
                {decided.rejection_reason ? ` — ${decided.rejection_reason}` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
