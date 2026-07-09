import { Card, SeverityBadge, ServiceBadge } from "./ui";
import type { RunState } from "./types";

export function IncidentPanel({ run }: { run: RunState }) {
  const sig = run.signature;

  return (
    <Card title="Incident Detected" step={1}>
      <div className="space-y-4">
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-base font-medium text-white/90">{run.title}</p>
            <SeverityBadge severity={sig?.severity ?? run.severity} />
          </div>
          <p className="mt-1 font-mono text-xs text-white/40">
            {run.incidentId}
          </p>
        </div>

        {sig && (
          <>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
                Affected services
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sig.affected_services.map((s) => (
                  <ServiceBadge key={s} name={s} />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
                Primary anomaly
              </p>
              <p className="rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-amber-200/90">
                {sig.primary_error_pattern}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/60">
              <span>
                <span className="text-white/40">Detected: </span>
                {sig.anomaly_start_timestamp ?? "—"}
              </span>
              <span>
                <span className="text-white/40">Log lines: </span>
                {sig.raw_log_count}
              </span>
              <span>
                <span className="text-white/40">Chunks embedded: </span>
                {run.chunks?.length ?? 0}
              </span>
            </div>
          </>
        )}

        {!sig && (
          <p className="text-sm text-white/40">Analyzing incoming logs…</p>
        )}
      </div>
    </Card>
  );
}
