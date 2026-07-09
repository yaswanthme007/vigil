/**
 * Maintenance: delete INC-LIVE-* incidents (created during verification runs)
 * and their post-mortems, restoring the seeded baseline of 25 incidents.
 *
 * Run with: npx tsx scripts/reset-memory.ts
 */
import "../src/mastra/env";
import { qdrant } from "../src/mastra/qdrant/client";

async function main() {
  const before = await qdrant.count("incidents", { exact: true });
  console.log("incidents before:", before.count);

  const scroll = await qdrant.scroll("incidents", {
    limit: 500,
    with_payload: true,
    with_vector: false,
  });

  const livePoints = scroll.points.filter((p) =>
    String((p.payload as { incident_id?: string })?.incident_id ?? "").startsWith(
      "INC-LIVE"
    )
  );

  console.log(
    "INC-LIVE incidents found:",
    livePoints.map((p) => (p.payload as { incident_id?: string }).incident_id)
  );

  if (livePoints.length > 0) {
    await qdrant.delete("incidents", {
      wait: true,
      points: livePoints.map((p) => p.id),
    });

    // Also remove their post-mortems (PM-INC-LIVE-*).
    const pmScroll = await qdrant.scroll("postmortems", {
      limit: 500,
      with_payload: true,
      with_vector: false,
    });
    const livePms = pmScroll.points.filter((p) =>
      String(
        (p.payload as { postmortem_id?: string })?.postmortem_id ?? ""
      ).startsWith("PM-INC-LIVE")
    );
    if (livePms.length > 0) {
      await qdrant.delete("postmortems", {
        wait: true,
        points: livePms.map((p) => p.id),
      });
      console.log("deleted post-mortems:", livePms.length);
    }
  }

  const after = await qdrant.count("incidents", { exact: true });
  console.log("incidents after:", after.count);
}

main().catch((e) => {
  console.error("reset failed:", e);
  process.exit(1);
});
