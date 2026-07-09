import type { ReactNode } from "react";
import type { Severity } from "@/mastra/types";

/** A dark surface card with a title. */
export function Card({
  title,
  step,
  children,
  accent,
}: {
  title: string;
  step?: number;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.022] p-5">
      <div className="mb-4 flex items-center gap-2">
        {typeof step === "number" && (
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.05] font-mono text-xs font-semibold tabular-nums text-white/45">
            {step}
          </span>
        )}
        <h2
          className="text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: accent ?? "rgba(230,232,238,0.65)" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

// Red is reserved exclusively for the BLOCKED state, so severity never uses it.
// P1/P2 carry weight in amber (needs attention); P3/P4 sit neutral.
const SEVERITY_STYLES: Record<Severity, string> = {
  P1: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  P2: "bg-amber-500/10 text-amber-200/90 border-amber-500/20",
  P3: "bg-white/[0.04] text-white/60 border-white/10",
  P4: "bg-white/[0.04] text-white/50 border-white/10",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${SEVERITY_STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}

export function ServiceBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-white/70">
      {name}
    </span>
  );
}

/** Confidence bar 0-1. Green when strong, amber otherwise — never red. */
export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? "#34d399" : "#fbbf24";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-white/60">{pct}%</span>
    </div>
  );
}

/** Blast-radius meter: LOW green, ELEVATED amber, HIGH hot-amber.
 *  Red is reserved for the blocked seal — a high blast radius escalates in
 *  temperature (amber → orange) rather than borrowing the block's colour. */
export function BlastRadiusMeter({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = clamped >= 70 ? "#fb923c" : clamped >= 40 ? "#fbbf24" : "#34d399";
  const label = clamped >= 70 ? "HIGH" : clamped >= 40 ? "ELEVATED" : "LOW";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-white/50">Blast radius</span>
        <span
          className="font-mono text-xs font-semibold tabular-nums"
          style={{ color }}
        >
          {clamped}/100 · {label}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/** Enkrypt guardrail badge. */
export function EnkryptBadge({
  kind,
  label,
}: {
  kind: "grounded" | "safe" | "blocked";
  label: string;
}) {
  const styles =
    kind === "blocked"
      ? "bg-red-500/15 text-red-300 border-red-500/40"
      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  const icon = kind === "blocked" ? "⚠" : "✓";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${styles}`}
    >
      <span>{icon}</span>
      {label}
    </span>
  );
}
