"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { DemoControlPanel } from "./components/DemoControlPanel";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { IncidentPanel } from "./components/IncidentPanel";
import { RootCausePanel } from "./components/RootCausePanel";
import { RemediationPanel } from "./components/RemediationPanel";
import { PostMortemView } from "./components/PostMortemView";
import type { RunState, StatusResponse } from "./components/types";

export default function Dashboard() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const runIdRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    const runId = runIdRef.current;
    const url = runId ? `/api/status?runId=${runId}` : "/api/status";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setMemoryCount(data.memoryCount);
      if (data.run) setRun(data.run);
    } catch {
      /* transient — keep last state, dashboard must never crash */
    }
  }, []);

  // Poll every 2 seconds.
  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const triggerScenario = useCallback(
    async (scenario: string) => {
      setBusy(true);
      setRun(null);
      runIdRef.current = null;
      try {
        const res = await fetch("/api/incident", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        });
        const data = (await res.json()) as { runId?: string };
        if (data.runId) {
          runIdRef.current = data.runId;
          await poll();
        }
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    },
    [poll]
  );

  const submitDecision = useCallback(
    async (approved: boolean, rejectionReason?: string) => {
      if (!runIdRef.current) return;
      setBusy(true);
      try {
        await fetch("/api/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: runIdRef.current,
            approved,
            rejection_reason: rejectionReason,
            engineer_id: "on-call-engineer",
          }),
        });
        await poll();
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    },
    [poll]
  );

  const escalate = useCallback(async () => {
    if (!runIdRef.current) return;
    setBusy(true);
    try {
      await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: runIdRef.current,
          escalate: true,
          engineer_id: "on-call-engineer",
        }),
      });
      await poll();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [poll]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <Header memoryCount={memoryCount} />

      <div className="mt-6 space-y-6">
        <section>
          <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
            Demo Control
          </p>
          <DemoControlPanel onTrigger={triggerScenario} busy={busy} />
        </section>

        {!run && (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] p-10 text-center">
            <p className="text-white/50">
              Trigger a scenario above to see Vigil respond in real time.
            </p>
            <p className="mt-1 text-xs text-white/30">
              Grounded root cause · Enkrypt safety gates · human approval ·
              self-improving memory
            </p>
          </div>
        )}

        {run && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-white/40">
                  Workflow
                </span>
                <StatusPill run={run} />
              </div>
              <WorkflowProgress run={run} />
            </div>

            {run.status === "escalated" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                {run.remediation
                  ? "Safety Gate escalation — a destructive remediation was routed to a human engineer. Vigil will not apply it."
                  : "No root-cause hypothesis passed the Enkrypt Grounding Gate. Escalated to a human — Vigil will not guess."}
              </div>
            )}

            {run.status === "blocked" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                The Safety Gate blocked this remediation as destructive. It
                cannot be approved — reject or escalate to a human.
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <IncidentPanel run={run} />
                <RootCausePanel run={run} />
              </div>
              <div className="space-y-6">
                <RemediationPanel
                  run={run}
                  onDecision={submitDecision}
                  onEscalate={escalate}
                  busy={busy}
                />
                <PostMortemView run={run} />
              </div>
            </div>
          </>
        )}
      </div>

      <footer className="mt-10 border-t border-white/10 pt-4 text-center text-xs text-white/30">
        Vigil — grounded, safe, self-improving incident response · Mastra ·
        Qdrant · Enkrypt · Groq
      </footer>
    </main>
  );
}

function StatusPill({ run }: { run: RunState }) {
  // Red is reserved for BLOCKED only. In-progress states read neutral;
  // "awaiting human" states (approval, escalation) read amber; resolved reads
  // green; engineer-declined and error read neutral.
  const NEUTRAL = "border-white/12 bg-white/[0.04] text-white/60";
  const AMBER = "border-amber-500/40 bg-amber-500/10 text-amber-300";
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: "Running", cls: NEUTRAL },
    awaiting_approval: { label: "Awaiting Approval", cls: AMBER },
    blocked: {
      label: "Blocked",
      cls: "border-red-500/40 bg-red-500/10 text-red-300",
    },
    generating_postmortem: { label: "Writing Post-Mortem", cls: NEUTRAL },
    completed: {
      label: "Resolved",
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    },
    rejected: { label: "Rejected", cls: NEUTRAL },
    escalated: { label: "Escalated", cls: AMBER },
    error: { label: "Error", cls: NEUTRAL },
  };
  const s = map[run.status] ?? map.running;
  return (
    <span
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums ${s.cls}`}
    >
      {s.label}
      {run.mttrMinutes && run.status === "completed"
        ? ` · MTTR ${run.mttrMinutes}m`
        : ""}
    </span>
  );
}
