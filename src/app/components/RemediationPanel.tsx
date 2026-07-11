"use client";

import { useState } from "react";
import { Card, BlastRadiusMeter, EnkryptBadge, ServiceBadge } from "./ui";
import {
  parseReason,
  blockedLead,
  blockedGateArc,
  type ReasonSource,
} from "./safety";
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

/** The Safety Gate seal — a struck circular medallion. The center verdict is
 *  a universal truth about a blocked plan (approval is refused by the engine,
 *  HTTP 403); the lower ring legend is DERIVED from the reason sources, so it
 *  never names Enkrypt unless Enkrypt actually flagged the remediation. Pure
 *  CSS/SVG, existing font stack. */
function SafetySeal({ arc, large = false }: { arc: string; large?: boolean }) {
  return (
    <div className="grid place-items-center py-1">
      <div className={`vigil-seal ${large ? "vigil-seal--lg" : ""}`}>
        <span
          className={`pointer-events-none absolute inset-x-0 text-center font-mono uppercase tracking-[0.32em] text-red-300/70 ${
            large ? "top-[24px] text-[10px]" : "top-[17px] text-[8.5px]"
          }`}
        >
          Safety Gate
        </span>
        <div className={large ? "px-8" : "px-6"}>
          <div
            className={`font-semibold leading-none tracking-[0.14em] text-red-300 [text-shadow:0_0_22px_rgba(239,68,68,0.45)] ${
              large ? "text-[44px]" : "text-[30px]"
            }`}
          >
            BLOCKED
          </div>
          <div
            className={`mx-auto mt-2 font-mono uppercase leading-[1.4] tracking-[0.22em] text-red-200/70 ${
              large ? "max-w-[11rem] text-[9px]" : "max-w-[8.5rem] text-[8px]"
            }`}
          >
            Human approval cannot override
          </div>
        </div>
        <span
          className={`pointer-events-none absolute inset-x-0 text-center font-mono uppercase tracking-[0.26em] text-red-300/55 ${
            large ? "bottom-[24px] text-[10px]" : "bottom-[17px] text-[8.5px]"
          }`}
        >
          {arc}
        </span>
      </div>
    </div>
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
  wide = false,
}: {
  run: RunState;
  onDecision: (approved: boolean, rejectionReason?: string) => void;
  onEscalate: () => void;
  busy: boolean;
  /** Full content width — the blocked state promoted to own the stage. */
  wide?: boolean;
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
    const reasons = plan.safety.reasons;

    /* Why — reasons enumerated, each tagged by source. */
    const whyBlock = (
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Why it was blocked
        </p>
        <ul className="space-y-1.5">
          {reasons.map((r, i) => {
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
    );

    /* The dangerous fix, visibly neutralized and locked. */
    const neutralizedBlock = (
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-white/40">
          <LockIcon className="h-3.5 w-3.5" />
          <p className="text-xs uppercase tracking-[0.18em]">
            Neutralized — will not execute
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
    );

    const metaBlock = (
      <div className="space-y-5">
        <BlastRadiusMeter score={plan.blast_radius_score} scale />
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
      </div>
    );

    /* Approve is absent by construction — its slot is shown withheld, so the
       room sees the refusal rather than a missing button. */
    const actionsBlock = actionable && !rejecting && (
      <div className="space-y-2 border-t border-white/10 pt-4">
        <div
          aria-disabled="true"
          title="Approval is withheld — a blocked remediation is structurally unapprovable (the engine refuses it, HTTP 403)."
          className="flex w-full select-none items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.14] bg-transparent px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-white/25"
        >
          <ProhibitIcon className="h-3.5 w-3.5" />
          Approve · Withheld
        </div>
        <div className="flex gap-2">
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
      </div>
    );

    const closingBlock = (
      <p className="border-t border-white/10 pt-3 text-center text-sm italic text-white/45">
        Vigil will not apply what it cannot undo.
      </p>
    );

    /* Full content width — the seal is centered across the whole column and
       owns the stage; everything else flows beneath it in one tight, centered
       reading measure (~720px). No left-aligned panel header to pull the eye. */
    if (wide) {
      return (
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.022] px-5 py-8 sm:px-8 sm:py-10">
          <p className="mb-7 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-red-300/70">
            Proposed Remediation
          </p>
          <SafetySeal arc={blockedGateArc(reasons)} large />
          <div className="mx-auto mt-2 max-w-[720px] space-y-6">
            <p className="text-balance text-center text-base leading-relaxed text-red-100/85">
              {blockedLead(reasons)}
            </p>
            {whyBlock}
            {neutralizedBlock}
            {metaBlock}
            {actionsBlock}
            {rejectEditor}
            {closingBlock}
          </div>
        </section>
      );
    }

    /* Narrow (two-column layouts) — the original single-column blocked panel. */
    return (
      <Card title="Proposed Remediation" step={5} accent="#fca5a5">
        <div className="space-y-5">
          <SafetySeal arc={blockedGateArc(reasons)} />
          <p className="text-center text-sm leading-relaxed text-red-100/85">
            {blockedLead(reasons)}
          </p>
          {whyBlock}
          {neutralizedBlock}
          {metaBlock}
          {actionsBlock}
          {rejectEditor}
          {closingBlock}
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
