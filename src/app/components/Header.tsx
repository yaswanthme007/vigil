export function Header({ memoryCount }: { memoryCount: number }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-lg font-black text-emerald-400 ring-1 ring-emerald-500/30">
          V
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight">
            VIGIL
            <span className="ml-2 align-middle text-xs font-medium uppercase tracking-widest text-white/40">
              AI-Powered Incident Response
            </span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm text-white/70">System Active</span>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <span className="text-xs text-white/50">Incidents in memory</span>
          <span className="ml-2 font-mono text-sm font-bold text-emerald-400">
            {memoryCount}
          </span>
        </div>
      </div>
    </header>
  );
}
