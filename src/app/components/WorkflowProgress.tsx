import { STEPS, type RunState } from "./types";

export function WorkflowProgress({ run }: { run: RunState }) {
  const current = run.step; // 1..8
  const terminal =
    run.status === "completed" ||
    run.status === "rejected" ||
    run.status === "escalated" ||
    run.status === "blocked" ||
    run.status === "error";

  // The step where the run halted, and how to colour it. Red is reserved for a
  // genuine BLOCK; escalation reads amber (awaiting a human); an engineer
  // rejection or an error reads neutral.
  const stopStyle: Record<string, { cls: string; glyph: string }> = {
    blocked: { cls: "bg-red-500/20 text-red-300 border-red-500/40", glyph: "✕" },
    escalated: {
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/35",
      glyph: "!",
    },
    rejected: { cls: "bg-white/[0.06] text-white/55 border-white/12", glyph: "✕" },
    error: { cls: "bg-white/[0.06] text-white/55 border-white/12", glyph: "!" },
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current || (terminal && run.status === "completed");
        const active = n === current && !terminal;
        const stop = n === current && terminal && run.status !== "completed"
          ? stopStyle[run.status]
          : undefined;

        const color = stop
          ? stop.cls
          : done
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            : active
              ? "bg-white/10 text-white border-white/30"
              : "bg-white/[0.02] text-white/30 border-white/10";

        return (
          <div
            key={label}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 ease-out ${color}`}
          >
            <span className="font-mono font-bold tabular-nums">
              {done ? "✓" : stop ? stop.glyph : n}
            </span>
            <span>{label}</span>
            {active && (
              <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
          </div>
        );
      })}
    </div>
  );
}
