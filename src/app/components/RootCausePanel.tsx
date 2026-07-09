"use client";

import { useState } from "react";
import { Card, ConfidenceBar, EnkryptBadge } from "./ui";
import type { RunState } from "./types";
import type { RootCauseHypothesis, LogChunk, SimilarIncident } from "@/mastra/types";

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

/** Resolve a citation id to its backing evidence. */
function resolve(id: string, run: RunState): {
  chunk?: LogChunk;
  incident?: SimilarIncident;
} {
  return {
    chunk: run.chunks?.find((c) => c.ref === id),
    incident: run.similarIncidents?.find((s) => s.incident_id === id),
  };
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
  // Which citation, if any, is expanded inline beneath this hypothesis.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-xs font-bold tabular-nums text-white/40">
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
          {hypothesis.evidence_ids.map((id) => {
            const { chunk, incident } = resolve(id, run);
            const resolvable = Boolean(chunk || incident);
            return (
              <CitationChip
                key={id}
                id={id}
                resolvable={resolvable}
                open={openId === id}
                onToggle={() =>
                  setOpenId((cur) => (cur === id ? null : id))
                }
              />
            );
          })}
        </div>
      </div>

      {/* Inline evidence — grid-rows 0fr→1fr expands smoothly and reflows the
          card without a jump. Collapsed content is fully clipped. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          openId ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {openId && <Evidence id={openId} run={run} />}
        </div>
      </div>
    </div>
  );
}

function CitationChip({
  id,
  resolvable,
  open,
  onToggle,
}: {
  id: string;
  resolvable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={() => resolvable && onToggle()}
      aria-expanded={open}
      title={resolvable ? "Show the evidence" : "Evidence unavailable"}
      className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-150 ease-out ${
        !resolvable
          ? "cursor-default border-white/10 bg-white/5 text-white/40"
          : open
            ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-100"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
      }`}
    >
      {id}
    </button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The actual grounding evidence behind a citation — proves "grounded" is real. */
function Evidence({ id, run }: { id: string; run: RunState }) {
  const { chunk, incident } = resolve(id, run);

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
      {chunk && (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wide text-emerald-400/70">
              Log evidence · {chunk.service ?? "unknown"}
            </span>
            {chunk.timestamp_start && (
              <span className="font-mono text-[10px] tabular-nums text-white/40">
                {chunk.timestamp_start}
              </span>
            )}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-white/70">
            {chunk.text}
          </pre>
        </>
      )}

      {incident && (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wide text-emerald-400/70">
              Past incident · {incident.incident_id}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-white/40">
              {formatDate(incident.created_at)} · {(incident.score * 100).toFixed(0)}% match
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-white/80">
            {incident.summary}
          </p>
          <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wide text-emerald-400/70">
              What fixed it
            </p>
            <p className="mt-0.5 text-[12px] text-white/80">
              {incident.remediation_applied}
            </p>
            <p className="mt-1 font-mono text-[10px] tabular-nums text-white/45">
              {incident.remediation_worked ? "resolved" : "did not resolve"} · MTTR{" "}
              {incident.mttr_minutes}m · {incident.severity}
            </p>
          </div>
        </>
      )}

      {!chunk && !incident && (
        <p className="text-[12px] text-white/40">Evidence unavailable.</p>
      )}
    </div>
  );
}
