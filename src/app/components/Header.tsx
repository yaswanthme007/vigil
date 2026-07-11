"use client";

import { useEffect, useRef } from "react";

/** The flywheel: when a post-mortem saves, the count rolls 25 → 26. Rolls only
 *  on a genuine increment from an established value — the first load and any
 *  reset snap silently, so nothing counts up on page open. */
function MemoryCounter({ value }: { value: number }) {
  const prevRef = useRef<number | null>(null);
  const prev = prevRef.current;
  const rolling = prev !== null && prev > 0 && value > prev;

  useEffect(() => {
    prevRef.current = value;
  }, [value]);

  return (
    <span className="inline-block h-[1.2em] overflow-hidden align-middle leading-[1.2em]">
      <span
        key={value}
        className={`block font-mono text-sm font-semibold tabular-nums leading-[1.2em] text-emerald-400/90 ${
          rolling ? "animate-roll" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}

export function Header({
  memoryCount,
  onNewIncident,
  showNewIncident,
}: {
  memoryCount: number;
  onNewIncident?: () => void;
  showNewIncident?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/12 font-mono text-base font-bold text-emerald-400/90 ring-1 ring-emerald-500/25">
          V
        </div>
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-lg font-semibold tracking-tight">Vigil</h1>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
            Incident Response
          </span>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-white/55">System active</span>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
          <span className="text-xs text-white/45">Incidents in memory</span>
          <MemoryCounter value={memoryCount} />
        </div>

        {/* Always-available escape hatch during a run: walk away and start
            fresh even if the run is stuck server-side. Memory is untouched. */}
        {showNewIncident && onNewIncident && (
          <button
            onClick={onNewIncident}
            title="Leave this run and start a new incident (memory is untouched)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/60 transition-colors duration-150 ease-out hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white/85"
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
        )}
      </div>
    </header>
  );
}
