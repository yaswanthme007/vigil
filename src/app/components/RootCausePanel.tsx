"use client";

import { useState } from "react";
import { Card, ConfidenceBar, EnkryptBadge } from "./ui";
import type { RunState } from "./types";
import type { RootCauseHypothesis } from "@/mastra/types";

export function RootCausePanel({ run }: { run: RunState }) {
  const hypotheses = run.hypotheses ?? [];
  const dropped = run.droppedHypotheses ?? [];

  return (
    <Card title="Root Cause Analysis" step={3}>
      {hypotheses.length === 0 && run.step < 4 && (
        <p className="text-sm text-white/40">Generating hypotheses…</p>
      )}

      {hypotheses.length === 0 && run.step >= 4 && (
        <p className="text-sm text-amber-300/80">
          No hypothesis passed the Grounding Gate — escalated to a human.
        </p>
      )}

      <div className="space-y-3">
        {hypotheses.map((h, i) => (
          <HypothesisRow key={i} rank={i + 1} hypothesis={h} run={run} grounded />
        ))}
      </div>

      {dropped.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-white/30">
            Dropped by Grounding Gate ({dropped.length})
          </p>
          <div className="space-y-2">
            {dropped.map((h, i) => (
              <div
                key={i}
                className="rounded-md border border-white/5 bg-black/20 px-3 py-2 text-xs text-white/40 line-through"
              >
                {h.explanation}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function HypothesisRow({
  rank,
  hypothesis,
  run,
  grounded,
}: {
  rank: number;
  hypothesis: RootCauseHypothesis;
  run: RunState;
  grounded: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-xs font-bold text-white/40">
            #{rank}
          </span>
          <div>
            <p className="text-sm text-white/90">{hypothesis.explanation}</p>
            <p className="mt-1 font-mono text-[11px] text-white/40">
              {hypothesis.root_cause_category}
            </p>
          </div>
        </div>
        {grounded && <EnkryptBadge kind="grounded" label="Grounded" />}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <ConfidenceBar value={hypothesis.confidence} />
        <div className="flex flex-wrap gap-1.5">
          {hypothesis.evidence_ids.map((id) => (
            <Citation key={id} id={id} run={run} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Citation({ id, run }: { id: string; run: RunState }) {
  const [open, setOpen] = useState(false);

  const chunk = run.chunks?.find((c) => c.ref === id);
  const incident = run.similarIncidents?.find((s) => s.incident_id === id);
  const resolvable = Boolean(chunk || incident);

  return (
    <span className="relative">
      <button
        onClick={() => resolvable && setOpen((v) => !v)}
        className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition ${
          resolvable
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            : "border-white/10 bg-white/5 text-white/40"
        }`}
        title={resolvable ? "Click to view evidence" : "Evidence unavailable"}
      >
        {id}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-80 rounded-lg border border-white/15 bg-[#0d0f15] p-3 text-left shadow-xl shadow-black/50">
          {chunk && (
            <>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-400/70">
                Log chunk · {chunk.service ?? "unknown"}
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-white/70">
                {chunk.text}
              </pre>
            </>
          )}
          {incident && (
            <>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-400/70">
                Past incident · {incident.incident_id} ·{" "}
                {(incident.score * 100).toFixed(0)}% match
              </p>
              <p className="text-[12px] text-white/80">{incident.summary}</p>
              <p className="mt-1.5 text-[11px] text-white/50">
                Fix: {incident.remediation_applied}
              </p>
              <p className="mt-1 text-[11px] text-white/40">
                Worked: {incident.remediation_worked ? "yes" : "no"} · MTTR{" "}
                {incident.mttr_minutes}m
              </p>
            </>
          )}
        </div>
      )}
    </span>
  );
}
