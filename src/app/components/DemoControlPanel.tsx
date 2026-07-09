"use client";

const BUTTONS = [
  {
    key: "A",
    label: "Trigger: DB Pool Exhaustion",
    sub: "Scenario A — safe fix, shows memory",
    className:
      "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200",
  },
  {
    key: "B",
    label: "Trigger: Destructive Incident",
    sub: "Scenario B — safety gate fires live",
    className:
      "border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-200",
  },
  {
    key: "C",
    label: "Trigger: Variant Incident",
    sub: "Scenario C — faster, shows flywheel",
    className:
      "border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200",
  },
  {
    key: "D",
    label: "Trigger: Prompt Injection Attempt",
    sub: "Scenario D — Enkrypt threat scan blocks it",
    className:
      "border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-200",
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
          className={`rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${b.className}`}
        >
          <div className="text-sm font-semibold">{b.label}</div>
          <div className="mt-0.5 text-xs opacity-70">{b.sub}</div>
        </button>
      ))}
    </div>
  );
}
