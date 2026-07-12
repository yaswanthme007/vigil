# Vigil

**AI incident response that cannot guess and cannot do harm.**

Vigil is a production-grade AI agent for on-call engineers. It ingests incident logs, retrieves similar past incidents from institutional memory, generates root-cause hypotheses grounded in the actual evidence, proposes remediations that are checked for destructiveness before a human ever sees them, and writes the post-mortem once the incident is resolved. Every hypothesis it can't ground is dropped; every destructive plan is made structurally unapprovable. It is built to be trusted at 2am.

**Live demo:** https://vigil-1-hqvy.onrender.com

## Core idea

Most "AI for incidents" tools fail in one of two ways: they hallucinate a confident root cause with no evidence, or they'll happily execute a fix that drops a table. Vigil closes both holes with two gates and a flywheel.

- **Grounding Gate.** After root-cause generation, every hypothesis is checked against the retrieved evidence. Anything not supported by a real log line or a past incident is dropped. If nothing survives, Vigil escalates to a human rather than guess.
- **Safety Gate.** Every proposed remediation is scanned before approval. A plan flagged as destructive is *blocked* — and the approval endpoint returns `HTTP 403` if a human tries to approve it anyway. Destructive fixes aren't discouraged, they're unapprovable by construction. Human approval cannot override the gate.
- **The flywheel.** Every resolved incident and its post-mortem are written back to `Qdrant`. The next incident retrieves them. Vigil measurably resolves faster on a variant of a problem it has seen before — the system improves with use.

## Stack

- **`Mastra`** — orchestrates an 8-step `incidentResponseWorkflow` with genuine `suspend`/`resume` for the human-in-the-loop approval step. The workflow pauses at the Safety Gate, persists state, and resumes on the engineer's decision.
- **`Qdrant`** — institutional memory across 4 collections: `incidents`, `log_chunks`, `runbooks`, and `postmortems`. Hybrid search over 25 seeded incidents, self-improving as new incidents resolve.
- **`Enkrypt AI`** — real guardrail API. `/guardrails/hallucination` backs grounding checks and `/guardrails/detect` scans remediations for threats. Scenario D demonstrates `Enkrypt` catching a prompt-injection payload that Vigil's own destructive-action policy does not flag.
- **`Groq`** — `llama-3.1-8b-instant` via `Mastra` model routing, for low-latency generation.
- **`Next.js 16`** + **`TypeScript`** — App Router, custom server, a live operations dashboard.
- **Local embeddings** — `MiniLM` (384-dim), pre-bundled. No embedding API calls at runtime.

## Demo scenarios

- **A — DB Pool Exhaustion.** Grounded root cause: Vigil cites the exact log line and the past incident that fixed this before, then proposes a safe remediation for approval.
- **B — Destructive Incident.** The proposed fix is destructive. The Safety Gate blocks it and approval returns `403` — proof that a dangerous plan cannot be executed.
- **C — Variant Incident.** A variant of A. Vigil retrieves what it learned from A and resolves faster — the flywheel, visible.
- **D — Prompt Injection Attempt.** `Enkrypt` catches an injection payload that Vigil's own policy misses — defense in depth from a real external guardrail.

## Team

- **Yaswanth K B** ([@yaswanthme007](https://github.com/yaswanthme007)) — build lead
- **Sheshakanth R A** — architecture and design

## Branches

- `main`, tag `frozen-perfect` — the verified fallback build.
- `redesign`, tag `finale-demo` — the finale build.
