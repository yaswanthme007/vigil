# Vigil — Incident Response & Post-Mortem Agent

## What we're building
A production-grade AI agent that helps on-call engineers resolve outages safely.
Solo build by Yaswanth K B, using Claude Code. Deadline: 12 July 2026 live finale in Bengaluru.
Hackathon: HiDevs × Mastra Championship Arena — Incident Response & Post-Mortem track.

## Core principle
Vigil is structurally incapable of:
1. Presenting an ungrounded root cause (Enkrypt Grounding Gate kills it)
2. Running a destructive fix without human approval (Enkrypt Safety Gate blocks it)
Safety + reliability is the entire pitch. Build the core end-to-end first.
The app must always be runnable at end of every day. Never commit a broken build.

## Stack (all free tier)
- TypeScript, Next.js 14 (App Router), Tailwind CSS
- Mastra (@mastra/core, @mastra/rag) — REQUIRED by hackathon
- Qdrant Cloud (@qdrant/js-client-rest) — REQUIRED by hackathon
- Enkrypt AI — REQUIRED by hackathon
- Groq llama-3.1-8b-instant (LLM via @ai-sdk/groq provider)
- Google gemini-embedding-001, truncated to 768-dim (embeddings for Qdrant) — Gemini used for embeddings only
- Deploy: Vercel (frontend) + Qdrant Cloud (DB)

## Environment variables (.env.local)
QDRANT_URL=
QDRANT_API_KEY=
GROQ_API_KEY=          # LLM (Groq llama-3.1-8b-instant)
GEMINI_API_KEY=        # embeddings only (text-embedding-004)
ENKRYPT_API_KEY=

## Repo structure
vigil/
├── CLAUDE.md
├── .env.local
├── package.json
├── src/
│   ├── mastra/
│   │   ├── index.ts                    # Mastra instance (agent + workflows)
│   │   ├── agent.ts                    # vigilAgent (Groq) — own module to avoid import cycle
│   │   ├── types.ts                    # Zod schemas + types for all workflow steps
│   │   ├── ids.ts                      # stableId() — deterministic UUIDs for idempotent upserts
│   │   ├── embeddings.ts               # Gemini embeddings (gemini-embedding-001 @ 768-dim)
│   │   ├── workflows/
│   │   │   └── incidentResponse.ts     # 8-step workflow
│   │   ├── tools/
│   │   │   ├── searchIncidents.ts
│   │   │   ├── searchRunbooks.ts
│   │   │   ├── searchLogs.ts
│   │   │   ├── estimateBlastRadius.ts
│   │   │   └── createPostmortem.ts
│   │   ├── guardrails/
│   │   │   └── enkrypt.ts              # Enkrypt wrapper
│   │   └── qdrant/
│   │       ├── client.ts               # Qdrant connection
│   │       ├── collections.ts          # 4 collection definitions
│   │       └── seed.ts                 # Synthetic data seeder
│   ├── app/
│   │   ├── page.tsx                    # Main dashboard
│   │   ├── api/
│   │   │   ├── incident/route.ts       # Trigger incident
│   │   │   └── approve/route.ts        # Human approval
│   │   └── components/
│   │       ├── IncidentPanel.tsx
│   │       ├── RootCausePanel.tsx
│   │       ├── RemediationPanel.tsx
│   │       └── PostMortemView.tsx
│   └── data/
│       └── synthetic/
│           ├── incidents.json
│           └── runbooks.json

## The 8-step workflow: incidentResponseWorkflow
1. Ingest & Detect — chunk+embed logs → log_chunks, produce IncidentSignature
2. Retrieve Similar — hybrid search incidents + runbooks in Qdrant
3. Grounded Root Cause — ranked hypotheses, each with CITED evidence IDs + confidence score
4. Enkrypt Grounding Gate — drop ungrounded hypotheses; if none pass → escalate to human
5. Propose Remediation — draft fix from runbooks + estimateBlastRadius tool (0-100 score)
6. Enkrypt Safety Gate — block/escalate destructive actions
7. Human Approval — Mastra suspend/resume, engineer approves via dashboard
8. Generate Post-Mortem — write to postmortems + UPSERT resolved incident → incidents (flywheel)

## Qdrant collections (vector dim 768, cosine distance)
incidents:
  - summary_embedding (vector)
  - summary, services_affected[], symptoms[], root_cause_category
  - remediation_applied, remediation_worked (bool), mttr_minutes, severity (P1-P4)
  - created_at, postmortem_id

log_chunks:
  - chunk_embedding (vector)
  - raw_text, incident_id, service
  - timestamp_start, timestamp_end, ttl (72h)

runbooks:
  - content_embedding (vector)
  - title, applies_to_services[], symptom_pattern
  - steps[], risk_level (low/medium/high/critical)
  - requires_approval (bool), success_rate

postmortems:
  - content_embedding (vector)
  - incident_id, full_text
  - action_items[], prevention_recommendations[]
  - created_at, quality_score

## Mastra tools
- searchIncidents(query, severity?, services?) → top-K similar past incidents
- searchRunbooks(query, services?) → matching remediation procedures
- searchLogs(incidentId) → log chunks for current incident
- estimateBlastRadius(remediation) → {score: 0-100, affected_services[], reversible: bool}
- createPostmortem(incidentContext) → structured post-mortem document

## Enkrypt guardrails (src/mastra/guardrails/enkrypt.ts)
Export two functions:
- validateGrounding(hypotheses[]) → returns only hypotheses backed by cited evidence
- checkDestructiveAction(remediation) → {safe: bool, reasons: string[]}
  Blocks: data deletion, DROP TABLE/collection, scale-to-zero, disable-auth,
  modify production secrets, any action with no rollback path

## Dashboard components
- IncidentPanel: detected anomaly, affected services, severity badge, timeline
- RootCausePanel: ranked hypotheses with confidence + CLICKABLE citations
  (clicking citation shows the actual log chunk or past incident)
- RemediationPanel: fix steps, blast-radius meter (green/yellow/red),
  Enkrypt safety badge (Grounded ✓ / Safety Checked ✓ / Blocked ⚠️),
  Approve / Reject buttons
- PostMortemView: generated report + quality score
- Memory counter: "Incidents in memory: N" — shows the flywheel working

## Demo scenarios (hardcoded for live finale)
Scenario A: DB connection pool exhaustion (safe fix, matches seeded incident → shows memory)
Scenario B: Incident where obvious fix is DESTRUCTIVE → Safety Gate fires live on stage
Scenario C: Variant of A → resolves faster (shows learning/flywheel)

## Rules for Claude Code
- Keep app runnable at all times. Small tested increments.
- All three tools (Mastra, Qdrant, Enkrypt) must be genuinely integrated — not stubbed
  (stub Enkrypt ONLY if key is delayed, swap real API in as soon as key arrives)
- Structured TypeScript types between all workflow steps
- Handle all errors gracefully — UI must never crash during a live demo
- Dark theme dashboard — production-looking, not demo-looking