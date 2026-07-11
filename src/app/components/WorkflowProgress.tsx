import { type RunState } from "./types";

/** Short, telemetry-style labels for the vertical rail. These are display-only
 *  and stay index-aligned to the engine's 8 steps (STEPS in types.ts). */
const RAIL_STEPS = [
  "Detect",
  "Retrieve",
  "Root Cause",
  "Grounding Gate",
  "Remediate",
  "Safety Gate",
  "Human",
  "Post-Mortem",
];

/** The signal spine — a vertical rail of the 8 workflow steps connected by a
 *  hairline. Completed steps land green in a settling wave; the active step
 *  breathes (amber, slower "held breath" while suspended at Human Approval);
 *  a genuine block shows a red ✗ node. Red is reserved for BLOCKED only. */
export function WorkflowProgress({ run }: { run: RunState }) {
  const current = run.step; // 1..8
  const terminal =
    run.status === "completed" ||
    run.status === "rejected" ||
    run.status === "escalated" ||
    run.status === "blocked" ||
    run.status === "error";
  const waiting = run.status === "awaiting_approval";

  // Glyph for the node where a terminal run stopped (non-completed).
  const stopGlyph: Record<string, string> = {
    blocked: "✕",
    escalated: "!",
    rejected: "✕",
    error: "!",
  };

  return (
    <ol className="relative">
      {RAIL_STEPS.map((label, i) => {
        const n = i + 1;
        const last = i === RAIL_STEPS.length - 1;
        const done = n < current || (terminal && run.status === "completed");
        const active = n === current && !terminal;
        const stopKind =
          n === current && terminal && run.status !== "completed"
            ? run.status
            : undefined;

        // Node dot + label styling, from the reserved palette.
        let dotCls = "border-white/15 bg-[var(--background)] text-white/30";
        let labelCls = "text-white/35";
        let ring = "";
        let breath = "";
        let glyph: string = String(n);

        if (done) {
          dotCls = "border-emerald-500/60 bg-emerald-500/10 text-emerald-300";
          labelCls = "text-white/70";
          glyph = "✓";
        } else if (stopKind === "blocked") {
          dotCls = "border-red-500/60 bg-red-500/15 text-red-300";
          labelCls = "text-red-300";
          ring = "ring-4 ring-red-500/15";
          glyph = stopGlyph.blocked;
        } else if (stopKind === "escalated") {
          dotCls = "border-amber-500/55 bg-amber-500/15 text-amber-300";
          labelCls = "text-amber-300";
          glyph = stopGlyph.escalated;
        } else if (stopKind) {
          // rejected / error — neutral, never red.
          dotCls = "border-white/20 bg-white/[0.06] text-white/55";
          labelCls = "text-white/55";
          glyph = stopGlyph[stopKind];
        } else if (active) {
          glyph = "";
          if (waiting) {
            dotCls = "border-amber-500/60 bg-amber-500 text-[var(--background)]";
            labelCls = "text-amber-300";
            ring = "ring-4 ring-amber-500/15";
            breath = "animate-hold";
          } else {
            dotCls = "border-white/40 bg-white text-[var(--background)]";
            labelCls = "text-white";
            ring = "ring-4 ring-white/10";
            breath = "animate-breathe";
          }
        }

        // The connector below a completed node carries the green settle downward.
        const connectorCls = done
          ? "bg-gradient-to-b from-emerald-500/50 to-white/10"
          : "bg-white/[0.1]";

        return (
          <li key={label} className={`flex gap-3 ${last ? "" : "min-h-[2.9rem]"}`}>
            {/* dot + connector column */}
            <div className="flex flex-col items-center">
              <span
                style={done ? { animationDelay: `${i * 40}ms` } : undefined}
                className={`relative z-10 grid h-4 w-4 flex-none place-items-center rounded-full border font-mono text-[9px] font-bold leading-none tabular-nums transition-colors duration-150 ease-out ${dotCls} ${ring} ${breath} ${
                  done ? "animate-settle" : ""
                }`}
              >
                {glyph}
              </span>
              {!last && <span className={`my-1 w-px flex-1 ${connectorCls}`} />}
            </div>

            {/* label */}
            <span
              style={done ? { animationDelay: `${i * 40}ms` } : undefined}
              className={`-mt-px text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 ease-out ${labelCls} ${
                done ? "animate-settle" : ""
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
