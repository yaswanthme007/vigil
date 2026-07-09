import "./src/mastra/env";
import express from "express";
import next from "next";
import { warmupEmbeddings } from "./src/mastra/embeddings";

/**
 * Vigil standalone server for the live finale (Railway.app, not Vercel).
 *
 * Vigil's run engine keeps incident state in-memory on globalThis, which only
 * works inside a SINGLE long-lived Node process. Vercel's serverless functions
 * freeze between invocations and don't share memory, so we run Next.js behind a
 * persistent Express process instead. Express hands every request to Next's own
 * request handler, so the existing App-Router API routes (/api/incident,
 * /api/approve, /api/status) and the dashboard all work unchanged — and the
 * engine's globalThis state survives across requests.
 */
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev: false });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const server = express();

  // No body parser: Next reads the raw request stream itself, so we must not
  // consume it here. A path-less middleware matches every method and route
  // (Express 5 rejects "*" wildcards, so we use `use`).
  server.use((req, res) => {
    void handle(req, res);
  });

  server.listen(port, () => {
    console.log(`▲ Vigil is live on http://localhost:${port}`);
    console.log(`   health: http://localhost:${port}/api/status`);
  });

  // Preload the local embedding model so the first incident on stage doesn't
  // pay the cold-start cost. Non-blocking: the server is already accepting
  // requests; this just warms the cache.
  warmupEmbeddings()
    .then(() => console.log("   ✓ embedding model warmed up"))
    .catch((err) => console.warn("   embedding warmup failed:", err));
}

main().catch((err) => {
  console.error("Failed to start Vigil server:", err);
  process.exit(1);
});
