"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { DemoControlPanel } from "./components/DemoControlPanel";
import { IdleBriefing } from "./components/IdleBriefing";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { IncidentPanel } from "./components/IncidentPanel";
import { RootCausePanel } from "./components/RootCausePanel";
import { RemediationPanel } from "./components/RemediationPanel";
import { PostMortemView } from "./components/PostMortemView";
import { blockedByText } from "./components/safety";
import type { RunState, StatusResponse } from "./components/types";

/** States in which a run has finished and can be cleared for a new incident. */
const TERMINAL_STATUSES = new Set([
  "completed",
  "rejected",
  "blocked",
  "escalated",
  "error",
]);

export default function Dashboard() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  // Set the instant a scenario is triggered, cleared when the new run arrives.
  // Bridges the gap where run is briefly null so the briefing never flashes.
  const [launching, setLaunching] = useState(false);
  const runIdRef = useRef<string | null>(null);
  // Once a run is cleared client-side, ignore the server's "latest run" until a
  // new scenario is triggered — so Reset returns to idle and stays there.
  const dismissedRef = useRef(false);
  // Launching guards (refs so the stable poll callback can read them):
  //  - launchingRef mirrors the launching state for poll's logic.
  //  - launchAtRunIdRef holds the runId visible at click-time, so we can reject
  //    the previous run bleeding back through /api/status (no runId → latestRun)
  //    until the freshly-created run's id arrives.
  const launchingRef = useRef(false);
  const launchAtRunIdRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    const runId = runIdRef.current;
    const url = runId ? `/api/status?runId=${runId}` : "/api/status";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setMemoryCount(data.memoryCount);
      if (dismissedRef.current) return; // idle after Reset — keep run cleared

      if (launchingRef.current) {
        // While a new run spins up, accept ONLY the freshly-created run. Ignore
        // the previous run bleeding through /api/status (no runId → latestRun)
        // so the UI never flashes the old scenario's steps/panels.
        const r = data.run;
        const isNewRun =
          !!r &&
          r.runId !== launchAtRunIdRef.current &&
          r.runId === runIdRef.current;
        if (isNewRun) {
          setRun(r);
          launchingRef.current = false;
          setLaunching(false);
        }
        return; // otherwise keep the "initializing incident…" scaffold up
      }

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
      // Remember the run visible at click-time so poll can reject it bleeding
      // back through latestRun, then enter the launching state.
      launchAtRunIdRef.current = runIdRef.current;
      launchingRef.current = true;
      setLaunching(true); // hold the run view up while the new run spins up
      setRun(null);
      runIdRef.current = null;
      dismissedRef.current = false; // a new run should render again
      try {
        const res = await fetch("/api/incident", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        });
        const data = (await res.json()) as { runId?: string };
        if (data.runId) {
          runIdRef.current = data.runId;
          await poll(); // accepts the new run and clears launching
        } else {
          launchingRef.current = false;
          setLaunching(false); // no run came back — fall back to idle
        }
      } catch {
        launchingRef.current = false;
        setLaunching(false); // request failed — fall back to idle
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

  // Clear the current run client-side and return to idle. Never touches the
  // server or Qdrant — the memory counter is unaffected.
  const resetRun = useCallback(() => {
    runIdRef.current = null;
    dismissedRef.current = true;
    launchingRef.current = false;
    setLaunching(false);
    setRun(null);
  }, []);

  const terminal = run ? TERMINAL_STATUSES.has(run.status) : false;
  // A run is "active" while it is in progress or awaiting a human — no new
  // scenario may be started on top of it.
  const runActive = Boolean(run) && !terminal;
  // Show the run view whenever a run exists OR one is spinning up. The briefing
  // appears only when genuinely idle (first load / after New incident).
  const showRun = launching || Boolean(run);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <Header memoryCount={memoryCount} />

      <div className="mt-6 space-y-6">
        {!showRun && (
          <IdleBriefing
            onTrigger={triggerScenario}
            memoryCount={memoryCount}
            busy={busy}
          />
        )}

        {showRun && (
          <section>
            <p className="mb-2 text-xs uppercase tracking-widest text-white/40">
              Demo Control
            </p>
            <DemoControlPanel
              onTrigger={triggerScenario}
              busy={busy || runActive}
            />
          </section>
        )}

        {/* Launching — a new run is spinning up. A minimal scaffold holds the
            run layout so the briefing never flashes back in between scenarios. */}
        {showRun && !run && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_1fr]">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
                  Workflow
                </p>
                <div className="mb-5">
                  <span className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/50 animate-breathe" />
                    Initializing
                  </span>
                </div>
                <p className="text-xs text-white/40">Initializing incident…</p>
              </div>
            </aside>
            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.022] p-10 text-center text-sm text-white/40">
                Initializing incident…
              </div>
            </div>
          </div>
        )}

        {run && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_1fr]">
            {/* LEFT — the signal spine. Status pill + MTTR live at its head. */}
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
                  Workflow
                </p>
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <StatusPill run={run} />
                  {terminal && <ResetButton onClick={resetRun} />}
                </div>
                <WorkflowProgress run={run} />
              </div>
            </aside>

            {/* RIGHT — content. A blocked run promotes the remediation panel to
                full content width; safe / awaiting keep the two-column layout. */}
            <div className="space-y-6">
              {run.status === "escalated" && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  {run.remediation
                    ? "Safety Gate escalation — a destructive remediation was routed to a human engineer. Vigil will not apply it."
                    : "No root-cause hypothesis passed the Enkrypt Grounding Gate. Escalated to a human — Vigil will not guess."}
                </div>
              )}

              {run.status === "blocked" ? (
                <>
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-400/90"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="9" />
                      <line x1="5.64" y1="5.64" x2="18.36" y2="18.36" />
                    </svg>
                    <span>
                      {blockedByText(run.remediation?.safety.reasons ?? [])}
                    </span>
                  </div>

                  {/* The block owns the stage. */}
                  <RemediationPanel
                    run={run}
                    onDecision={submitDecision}
                    onEscalate={escalate}
                    busy={busy}
                    wide
                  />

                  {/* Incident + root cause move beneath the verdict. */}
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <IncidentPanel run={run} />
                    <RootCausePanel run={run} />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="mt-10 border-t border-white/10 pt-4 text-center text-xs text-white/30">
        Vigil — grounded, safe, self-improving incident response · Mastra ·
        Qdrant · Enkrypt · Groq
      </footer>
    </main>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Clear this run and start a new incident (memory is untouched)"
      className="inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/60 transition-colors duration-150 ease-out hover:bg-white/[0.08] hover:text-white/80"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v4h4" />
      </svg>
      New incident
    </button>
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
  // Awaiting a human reads as a held breath, not an alert.
  const breath = run.status === "awaiting_approval" ? "animate-hold" : "";
  return (
    <span
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums ${s.cls} ${breath}`}
    >
      {s.label}
      {run.mttrMinutes && run.status === "completed"
        ? ` · MTTR ${run.mttrMinutes}m`
        : ""}
    </span>
  );
}
