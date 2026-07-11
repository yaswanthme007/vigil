"use client";

/**
 * The idle / landing state — a mission briefing that lets a first-time judge
 * understand Vigil in ~10 seconds. Rendered only when no run is active; the
 * moment a scenario is triggered this unmounts and the run experience takes
 * over. Presentation only: the deck calls the same onTrigger as before.
 *
 * Discipline: existing fonts, reserved colour law (green only on the live
 * memory count — the "self-improving" signal; no red anywhere here), and a
 * staggered fade-up on first load that the reduced-motion guard collapses.
 */

const PIPELINE: { label: string; gate?: boolean }[] = [
  { label: "Detect" },
  { label: "Retrieve" },
  { label: "Root Cause" },
  { label: "Grounding Gate", gate: true },
  { label: "Remediate" },
  { label: "Safety Gate", gate: true },
  { label: "Human" },
  { label: "Post-Mortem" },
];

const PILLARS: { name: string; role: string; claim: React.ReactNode }[] = [
  {
    name: "Mastra",
    role: "Orchestration",
    claim: "Orchestrates all 8 steps, including the human-in-the-loop suspend.",
  },
  {
    name: "Qdrant",
    role: "Memory",
    claim: null, // rendered with the live count below
  },
  {
    name: "Enkrypt",
    role: "Guardrail",
    claim: "Threat scan on every remediation. Catches what our own policy can't.",
  },
];

const DECK: { key: string; title: string; promise: string }[] = [
  {
    key: "A",
    title: "DB Pool Exhaustion",
    promise:
      "Watch it cite the exact log line and the past incident that fixed this before.",
  },
  {
    key: "B",
    title: "Destructive Incident",
    promise:
      "Watch it refuse a destructive fix — approval is impossible by design.",
  },
  {
    key: "C",
    title: "Variant Incident",
    promise: "Watch it resolve faster because it learned from A.",
  },
  {
    key: "D",
    title: "Prompt Injection Attempt",
    promise: "Watch Enkrypt catch an injection our own policy can't see.",
  },
];

export function IdleBriefing({
  onTrigger,
  memoryCount,
  busy,
}: {
  onTrigger: (scenario: string) => void;
  memoryCount: number;
  busy: boolean;
}) {
  const last = PIPELINE.length - 1;

  return (
    <div className="space-y-10">
      {/* 1 — THESIS */}
      <section className="animate-rise" style={{ animationDelay: "40ms" }}>
        <h1 className="max-w-3xl text-balance text-[27px] font-semibold leading-[1.16] tracking-[-0.01em] text-white/90 sm:text-[33px]">
          AI incident response that cannot guess and cannot do harm.
        </h1>
        <p className="mt-3.5 max-w-2xl text-sm leading-relaxed text-white/45">
          Grounded root causes · structurally unapprovable destructive fixes ·
          memory that compounds with every incident.
        </p>
      </section>

      {/* 2 — THE PIPELINE, PREVIEWED */}
      <section
        className="animate-rise rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 sm:p-6"
        style={{ animationDelay: "120ms" }}
      >
        <p className="mb-5 text-[10px] uppercase tracking-[0.2em] text-white/35">
          The pipeline
        </p>
        <div className="flex items-start">
          {PIPELINE.map((s, i) => (
            <div
              key={s.label}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              {/* connector + node */}
              <div className="relative flex h-5 w-full items-center justify-center">
                {i > 0 && (
                  <span className="absolute right-1/2 left-0 top-1/2 h-px bg-white/[0.1]" />
                )}
                {i < last && (
                  <span className="absolute left-1/2 right-0 top-1/2 h-px bg-white/[0.1]" />
                )}
                {s.gate ? (
                  <span className="relative z-10 grid h-3.5 w-3.5 rotate-45 place-items-center rounded-[3px] border border-white/35 bg-[var(--background)] shadow-[0_0_10px_rgba(255,255,255,0.06)]">
                    <span className="h-1 w-1 -rotate-45 rounded-full bg-white/50" />
                  </span>
                ) : (
                  <span className="relative z-10 h-2.5 w-2.5 rounded-full border border-white/20 bg-[var(--background)]" />
                )}
              </div>
              {/* label */}
              <span
                className={`mt-2.5 text-center text-[9px] uppercase leading-tight tracking-[0.08em] ${
                  s.gate ? "text-white/65" : "text-white/38"
                }`}
              >
                {s.label}
              </span>
              {s.gate && (
                <span className="mt-1 rounded-[3px] border border-white/12 px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/40">
                  Gate
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-xs leading-relaxed text-white/45">
          Every incident passes two gates. Nothing ungrounded reaches a human.
          Nothing destructive can be approved.
        </p>
      </section>

      {/* 3 — THE THREE PILLARS */}
      <section
        className="animate-rise grid grid-cols-1 gap-3 sm:grid-cols-3"
        style={{ animationDelay: "200ms" }}
      >
        {PILLARS.map((p) => (
          <div
            key={p.name}
            className="rounded-xl border border-white/[0.08] bg-white/[0.022] p-4"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">
                {p.name}
              </span>
              <span className="text-[9px] uppercase tracking-[0.16em] text-white/25">
                {p.role}
              </span>
            </div>
            <div className="mt-2.5 h-px w-full bg-white/[0.06]" />
            <p className="mt-3 text-[13px] leading-relaxed text-white/70">
              {p.name === "Qdrant" ? (
                <>
                  Institutional memory.{" "}
                  <span className="font-mono tabular-nums text-emerald-400/90">
                    {memoryCount}
                  </span>{" "}
                  incidents, 4 collections, hybrid search.
                </>
              ) : (
                p.claim
              )}
            </p>
          </div>
        ))}
      </section>

      {/* 4 — THE SCENARIO DECK */}
      <section className="animate-rise" style={{ animationDelay: "280ms" }}>
        <p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
          Run a scenario — watch what happens
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DECK.map((c) => (
            <button
              key={c.key}
              disabled={busy}
              onClick={() => onTrigger(c.key)}
              className="group flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-white/[0.022] p-4 text-left transition-colors duration-150 ease-out hover:border-white/[0.16] hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/12 bg-white/[0.04] font-mono text-sm font-semibold text-white/55 transition-colors group-hover:text-white/85">
                {c.key}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white/85">
                  {c.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/45">
                  {c.promise}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
