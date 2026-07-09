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

export function Header({ memoryCount }: { memoryCount: number }) {
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
      </div>
    </header>
  );
}
