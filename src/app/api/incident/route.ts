import { NextResponse } from "next/server";
import { startRun } from "@/mastra/engine/runStore";
import { getScenario } from "@/mastra/scenarios";
import type { IncidentInput, Severity } from "@/mastra/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/incident — triggers a new incident-response run.
 * Body: { scenario?: "A"|"B"|"C" } to use a preset demo scenario, OR
 *       { title, service?, severity?, logs } for a custom incident.
 * Returns { runId, incidentId, status } immediately; poll /api/status for progress.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      scenario?: string;
      title?: string;
      service?: string;
      severity?: Severity;
      logs?: string;
    };

    if (body.scenario) {
      const s = getScenario(body.scenario);
      if (!s) {
        return NextResponse.json(
          { error: `Unknown scenario "${body.scenario}"` },
          { status: 400 }
        );
      }
      const input: IncidentInput = {
        alert: { title: s.title, service: s.service, severity: s.severity },
        rawLogs: s.rawLogs,
      };
      const run = await startRun(input, {
        scenario: s.key,
        overrideSteps: s.remediationOverride,
        overrideRollback: s.remediationRollback,
      });
      return NextResponse.json({
        runId: run.runId,
        incidentId: run.incidentId,
        status: run.status,
      });
    }

    if (!body.logs || body.logs.trim().length === 0) {
      return NextResponse.json(
        { error: "Provide a `scenario` or `logs`." },
        { status: 400 }
      );
    }

    const input: IncidentInput = {
      alert: {
        title: body.title ?? "Custom incident",
        service: body.service,
        severity: body.severity,
      },
      rawLogs: body.logs,
    };
    const run = await startRun(input, { scenario: null });
    return NextResponse.json({
      runId: run.runId,
      incidentId: run.incidentId,
      status: run.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start incident" },
      { status: 500 }
    );
  }
}
