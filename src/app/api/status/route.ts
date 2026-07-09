import { NextResponse } from "next/server";
import { getRun, latestRun, getMemoryCount } from "@/mastra/engine/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/status?runId=... — returns the run's live state plus the memory
 * counter. Without runId, returns the most recent run (and the counter), so the
 * header can render "Incidents in memory: N" even before any run starts.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");
    const run = runId ? getRun(runId) : latestRun();
    const memoryCount = await getMemoryCount();
    return NextResponse.json({ run, memoryCount });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read status" },
      { status: 500 }
    );
  }
}
