import "../env";
import type { RootCauseHypothesis } from "../types";

/**
 * Enkrypt AI guardrails — Vigil's two hard safety gates.
 *
 *   validateGrounding    → Grounding Gate: drops ungrounded / hallucinated hypotheses
 *   checkDestructiveAction → Safety Gate: blocks destructive remediations
 *
 * When ENKRYPT_API_KEY is set, both gates call the real Enkrypt Guardrails API
 * (hallucination + detect endpoints). The domain heuristics remain as the
 * fallback whenever the API is unavailable, and — for destructive actions — as
 * the always-on base detector (Enkrypt's detectors target LLM-safety signals
 * like prompt injection and toxicity, not SRE-destructive commands such as
 * DROP TABLE, so we combine both). The public interfaces never change, so
 * flipping between real API and stub is purely a matter of the env var.
 */

const ENKRYPT_BASE_URL =
  process.env.ENKRYPT_BASE_URL || "https://api.enkryptai.com";
const ENKRYPT_TIMEOUT_MS = 8000;

function enkryptEnabled(): boolean {
  return Boolean(process.env.ENKRYPT_API_KEY);
}

/** POST helper for the Enkrypt Guardrails API (apikey header, JSON in/out). */
async function enkryptPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${ENKRYPT_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.ENKRYPT_API_KEY as string,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ENKRYPT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Enkrypt ${path} -> ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ── Destructive-action patterns (shared with estimateBlastRadius) ─────────── */

export interface DestructivePattern {
  pattern: RegExp;
  reason: string;
  /** false = irreversible (no rollback path) → far higher risk. */
  reversible: boolean;
}

/**
 * Patterns that make a remediation unsafe. Kept exported so the blast-radius
 * tool scores the same signals the Safety Gate blocks on.
 */
export const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  {
    pattern: /\bDROP\s+(TABLE|DATABASE|COLLECTION|SCHEMA|INDEX|KEYSPACE)\b/i,
    reason: "DROP of a database object — irreversible schema/data loss",
    reversible: false,
  },
  {
    pattern: /\bTRUNCATE\b/i,
    reason: "TRUNCATE — wipes all rows with no rollback",
    reversible: false,
  },
  {
    pattern: /\bDELETE\s+FROM\b|\bDELETE\b(?![^\n]*\bWHERE\b)/i,
    reason: "Unscoped DELETE — bulk data removal",
    reversible: false,
  },
  {
    pattern: /scale[^\n]*?\b(to\s*0|to\s*zero)\b|replicas?\s*[=:]\s*0|--replicas[= ]0/i,
    reason: "Scale-to-zero — takes the service fully offline",
    reversible: true,
  },
  {
    pattern: /disable[^\n]*?auth(entication|orization)?|--no-auth|auth[^\n]*?disabled?/i,
    reason: "Disables authentication — opens a security hole",
    reversible: true,
  },
  {
    pattern: /(remove|delete|rotate|overwrite|modify)[^\n]*?secret|secret[^\n]*?(remove|delete|wipe)/i,
    reason: "Modifies or removes production secrets",
    reversible: false,
  },
  {
    pattern: /flush[^\n]*?(data|all|db)|flushall|flushdb/i,
    reason: "Flushes a data store",
    reversible: false,
  },
  {
    pattern: /\b(destroy|wipe|purge|obliterate|nuke)\b/i,
    reason: "Destructive keyword (destroy/wipe/purge) — likely irreversible",
    reversible: false,
  },
  {
    pattern: /no\s+rollback|cannot\s+(be\s+)?(undone|rolled\s*back)|irreversible/i,
    reason: "Explicitly has no rollback path",
    reversible: false,
  },
];

/** A single detected destructive signal. */
export interface DestructiveMatch {
  reason: string;
  reversible: boolean;
}

/** Scan free text for destructive signals. Shared by the gate and the tool. */
export function scanDestructive(text: string): DestructiveMatch[] {
  const matches: DestructiveMatch[] = [];
  for (const { pattern, reason, reversible } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(text)) matches.push({ reason, reversible });
  }
  return matches;
}

/* ── Grounding Gate ──────────────────────────────────────────────────────── */

const MIN_CONFIDENCE = 0.3;
const HALLUCINATION_THRESHOLD = 0.5;

interface HallucinationResponse {
  summary?: { is_hallucination?: number };
  details?: { prompt_based?: number };
}

/**
 * Grounding Gate. Returns ONLY the hypotheses backed by cited evidence that
 * Enkrypt also judges to be non-hallucinated. An empty result means nothing
 * passed — the caller must escalate to a human.
 */
export async function validateGrounding(
  hypotheses: RootCauseHypothesis[]
): Promise<RootCauseHypothesis[]> {
  // Base structural filter: must cite real evidence and clear the confidence bar.
  const structural = hypotheses.filter(
    (h) => h.evidence_ids.length > 0 && h.confidence >= MIN_CONFIDENCE
  );

  if (!enkryptEnabled()) {
    console.warn(
      "Enkrypt stub active — using local grounding heuristic (set ENKRYPT_API_KEY for real validation)."
    );
    return structural;
  }

  try {
    const verdicts = await Promise.all(
      structural.map(async (h) => {
        const data = await enkryptPost<HallucinationResponse>(
          "/guardrails/hallucination",
          {
            request_text: h.explanation,
            response_text: h.explanation,
            context: h.evidence_ids.join(", "),
          }
        );
        const score = Number(data?.summary?.is_hallucination ?? 0);
        return { hypothesis: h, hallucinated: score > HALLUCINATION_THRESHOLD };
      })
    );
    return verdicts.filter((v) => !v.hallucinated).map((v) => v.hypothesis);
  } catch (err) {
    console.warn(
      "[enkrypt] hallucination API failed — falling back to structural grounding:",
      err
    );
    return structural;
  }
}

/* ── Safety Gate ─────────────────────────────────────────────────────────── */

export interface DestructiveCheck {
  safe: boolean;
  reasons: string[];
  blast_radius: number;
}

interface DetectResponse {
  summary?: {
    injection_attack?: number;
    toxicity?: string[] | number;
    nsfw?: number;
    policy_violation?: number;
  };
}

/**
 * Safety Gate. The domain keyword heuristic is the always-on base detector for
 * destructive SRE actions; Enkrypt's /detect adds LLM-threat signals (prompt
 * injection, toxicity). The remediation is unsafe if EITHER flags it.
 */
export async function checkDestructiveAction(
  remediation: string
): Promise<DestructiveCheck> {
  const base = heuristicDestructive(remediation);
  // Reasons are tagged by source so the dashboard can attribute the block:
  // [POLICY]  = Vigil's destructive-action heuristic (DROP/TRUNCATE/disable-auth…)
  // [ENKRYPT] = Enkrypt threat scan (prompt-injection / toxicity)
  const policyReasons = base.reasons.map((r) => `[POLICY] ${r}`);

  if (!enkryptEnabled()) {
    console.warn(
      "Enkrypt stub active — using local destructive-action heuristic (set ENKRYPT_API_KEY for real detection)."
    );
    return { ...base, reasons: policyReasons };
  }

  try {
    const data = await enkryptPost<DetectResponse>("/guardrails/detect", {
      text: remediation,
      // The API requires an explicit enabled flag per detector.
      detectors: {
        injection_attack: { enabled: true },
        toxicity: { enabled: true },
      },
    });

    const summary = data?.summary ?? {};
    const enkryptReasons: string[] = [];

    if (Number(summary.injection_attack) === 1) {
      enkryptReasons.push("[ENKRYPT] prompt-injection detected");
    }
    const toxicity = summary.toxicity;
    if (Array.isArray(toxicity) && toxicity.length > 0) {
      enkryptReasons.push(`[ENKRYPT] toxic content (${toxicity.join(", ")})`);
    } else if (typeof toxicity === "number" && toxicity === 1) {
      enkryptReasons.push("[ENKRYPT] toxic content detected");
    }

    const reasons = [...policyReasons, ...enkryptReasons];
    const blast_radius = Math.min(
      100,
      base.blast_radius + enkryptReasons.length * 20
    );

    return {
      safe: base.safe && enkryptReasons.length === 0,
      reasons,
      blast_radius,
    };
  } catch (err) {
    console.warn(
      "[enkrypt] detect API failed — falling back to heuristic:",
      err
    );
    return { ...base, reasons: policyReasons };
  }
}

/** Local heuristic: match destructive patterns and score their severity. */
function heuristicDestructive(remediation: string): DestructiveCheck {
  const matches = scanDestructive(remediation);
  const reasons = matches.map((m) => m.reason);

  // Irreversible actions weigh far more than reversible ones.
  let blast = 0;
  for (const m of matches) blast += m.reversible ? 20 : 40;
  blast = Math.min(100, blast);

  return { safe: matches.length === 0, reasons, blast_radius: blast };
}
