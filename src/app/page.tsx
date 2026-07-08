export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-indigo-900/40">
            {/* Shield glyph */}
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l7 3v5c0 4.418-3.134 7.567-7 9-3.866-1.433-7-4.582-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Vigil
            </h1>
            <p className="text-sm text-slate-400">
              AI-powered Incident Response
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-8 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-white">
                Incident Response Console
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Grounded root-cause analysis with human-approved remediation.
              </p>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs font-medium text-emerald-300">
                System Ready
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            {[
              { label: "Mastra", detail: "Orchestration" },
              { label: "Qdrant", detail: "Memory" },
              { label: "Enkrypt", detail: "Guardrails" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-4"
              >
                <div className="text-sm font-medium text-slate-200">
                  {s.label}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Day 0 · Scaffold verified · Bengaluru finale 12 Jul 2026
        </p>
      </div>
    </main>
  );
}
