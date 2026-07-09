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
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-center gap-2">
        {typeof step === "number" && (
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-xs font-semibold text-white/50">
            {step}
          </span>
        )}
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: accent ?? "rgba(230,232,238,0.7)" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  P1: "bg-red-500/15 text-red-300 border-red-500/30",
  P2: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  P3: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  P4: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${SEVERITY_STYLES[severity]}`}
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

/** Confidence bar 0-1. */
export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7 ? "#34d399" : value >= 0.4 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-xs text-white/60">{pct}%</span>
    </div>
  );
}

/** Blast-radius meter: 0-40 green, 40-70 yellow, 70+ red. */
export function BlastRadiusMeter({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = clamped >= 70 ? "#f87171" : clamped >= 40 ? "#fbbf24" : "#34d399";
  const label = clamped >= 70 ? "HIGH" : clamped >= 40 ? "ELEVATED" : "LOW";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-white/50">Blast radius</span>
        <span className="font-mono text-xs font-semibold" style={{ color }}>
          {clamped}/100 · {label}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-500"
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
