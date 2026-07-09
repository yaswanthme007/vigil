"use client";

// Uniform, neutral command buttons — the outcome is never previewed by colour
// (that would spoil the demo and, for the destructive case, misuse the reserved
// red). The mono key chip makes each fast to target on stage.
const BUTTONS = [
  {
    key: "A",
    label: "DB Pool Exhaustion",
    sub: "Safe fix · shows memory",
  },
  {
    key: "B",
    label: "Destructive Incident",
    sub: "Safety Gate fires live",
  },
  {
    key: "C",
    label: "Variant Incident",
    sub: "Faster · shows flywheel",
  },
  {
    key: "D",
    label: "Prompt Injection Attempt",
    sub: "Enkrypt threat scan blocks it",
  },
] as const;

export function DemoControlPanel({
  onTrigger,
  busy,
}: {
  onTrigger: (scenario: string) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          disabled={busy}
          onClick={() => onTrigger(b.key)}
          className="group flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.022] px-4 py-3 text-left transition-colors duration-150 ease-out hover:border-white/15 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-xs font-semibold text-white/50 transition-colors group-hover:text-white/80">
            {b.key}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white/85">
              {b.label}
            </span>
            <span className="mt-0.5 block text-xs text-white/40">{b.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
