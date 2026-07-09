import { NextResponse } from "next/server";
import { submitApproval, escalateRun } from "@/mastra/engine/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/approve — resumes a suspended run with the engineer's decision.
 * Body: { runId, approved, rejection_reason?, engineer_id? }
 *   or: { runId, escalate: true, engineer_id? } to hand off to a human.
 *
 * Approving a plan the Safety Gate blocked is refused with HTTP 403 — the
 * destructive fix is structurally unapprovable.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      runId?: string;
      approved?: boolean;
      rejection_reason?: string;
      engineer_id?: string;
      escalate?: boolean;
    };

    if (!body.runId) {
      return NextResponse.json({ error: "Provide `runId`." }, { status: 400 });
    }

    if (body.escalate === true) {
      const run = escalateRun(body.runId, body.engineer_id ?? "on-call-engineer");
      if (!run) {
        return NextResponse.json({ error: "Run not found." }, { status: 404 });
      }
      return NextResponse.json({ run });
    }

    if (typeof body.approved !== "boolean") {
      return NextResponse.json(
        { error: "Provide `approved` (boolean) or `escalate: true`." },
        { status: 400 }
      );
    }

    const result = submitApproval(body.runId, {
      approved: body.approved,
      rejection_reason: body.rejection_reason,
      engineer_id: body.engineer_id ?? "on-call-engineer",
    });

    if (!result.run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    if (result.refused) {
      // Safety Gate blocked this remediation — approval is not permitted.
      return NextResponse.json(
        { error: result.message, run: result.run },
        { status: 403 }
      );
    }

    return NextResponse.json({ run: result.run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit approval" },
      { status: 500 }
    );
  }
}
