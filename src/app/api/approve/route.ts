import { NextResponse } from "next/server";
import { submitApproval } from "@/mastra/engine/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/approve — resumes a suspended run with the engineer's decision.
 * Body: { runId, approved, rejection_reason?, engineer_id? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      runId?: string;
      approved?: boolean;
      rejection_reason?: string;
      engineer_id?: string;
    };

    if (!body.runId || typeof body.approved !== "boolean") {
      return NextResponse.json(
        { error: "Provide `runId` and `approved` (boolean)." },
        { status: 400 }
      );
    }

    const run = submitApproval(body.runId, {
      approved: body.approved,
      rejection_reason: body.rejection_reason,
      engineer_id: body.engineer_id ?? "on-call-engineer",
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit approval" },
      { status: 500 }
    );
  }
}
