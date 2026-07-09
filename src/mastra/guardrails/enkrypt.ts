import "../env";
import type { RootCauseHypothesis } from "../types";

/**
 * Enkrypt AI guardrails — Vigil's two hard safety gates.
 *
 *   validateGrounding    → Grounding Gate: drops ungrounded root-cause hypotheses
 *   checkDestructiveAction → Safety Gate: blocks destructive remediations
 *
 * DESIGN: each function has one public entry point with a STABLE interface. When
 * ENKRYPT_API_KEY is present we route to the real Enkrypt API; otherwise we fall
 * back to a local heuristic ("stub"). Swapping in the real key is therefore a
 * config change, not a code change — the callers never see the difference.
 *
 * The real-API branch is intentionally isolated in enkryptGrounding()/
 * enkryptDestructive() so wiring the live Enkrypt contract is a single, contained
 * edit once the key + API docs are in hand. Both are wrapped in try/catch so a
 * transient Enkrypt failure degrades to the heuristic instead of crashing a live
 * incident response.
 */

function enkryptEnabled(): boolean {
  return Boolean(process.env.ENKRYPT_API_KEY);
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

/**
 * Grounding Gate. Returns ONLY the hypotheses that are backed by cited evidence.
 * An empty result means nothing passed — the caller must escalate to a human.
 */
export async function validateGrounding(
  hypotheses: RootCauseHypothesis[]
): Promise<RootCauseHypothesis[]> {
  if (enkryptEnabled()) {
    try {
      return await enkryptGrounding(hypotheses);
    } catch (err) {
      console.warn(
        "[enkrypt] grounding API failed — falling back to heuristic:",
        err
      );
    }
  } else {
    console.warn(
      "Enkrypt stub active — using local grounding heuristic (set ENKRYPT_API_KEY for real validation)."
    );
  }
  return heuristicGrounding(hypotheses);
}

/** Local heuristic: keep hypotheses with real evidence and adequate confidence. */
function heuristicGrounding(
  hypotheses: RootCauseHypothesis[]
): RootCauseHypothesis[] {
  return hypotheses.filter(
    (h) => h.evidence_ids.length > 0 && h.confidence >= MIN_CONFIDENCE
  );
}

/* ── Safety Gate ─────────────────────────────────────────────────────────── */

export interface DestructiveCheck {
  safe: boolean;
  reasons: string[];
  blast_radius: number;
}

/**
 * Safety Gate. Inspects a remediation's text for destructive actions.
 * Returns { safe, reasons, blast_radius }. `safe: false` MUST block auto-apply.
 */
export async function checkDestructiveAction(
  remediation: string
): Promise<DestructiveCheck> {
  if (enkryptEnabled()) {
    try {
      return await enkryptDestructive(remediation);
    } catch (err) {
      console.warn(
        "[enkrypt] destructive-action API failed — falling back to heuristic:",
        err
      );
    }
  } else {
    console.warn(
      "Enkrypt stub active — using local destructive-action heuristic (set ENKRYPT_API_KEY for real detection)."
    );
  }
  return heuristicDestructive(remediation);
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

/* ── Real Enkrypt API branch (wired when ENKRYPT_API_KEY arrives) ─────────── */
/*
 * These are the single, contained edit points for the live Enkrypt integration.
 * Until the key + API contract are available they throw, so validateGrounding /
 * checkDestructiveAction transparently fall back to the heuristics above. Fill
 * in the real request/response mapping here — callers require no changes.
 */

async function enkryptGrounding(
  _hypotheses: RootCauseHypothesis[]
): Promise<RootCauseHypothesis[]> {
  // TODO(enkrypt): POST hypotheses to the Enkrypt grounding/faithfulness
  // guardrail and keep only those it marks as grounded.
  throw new Error("Enkrypt grounding API not yet wired");
}

async function enkryptDestructive(
  _remediation: string
): Promise<DestructiveCheck> {
  // TODO(enkrypt): POST the remediation text to the Enkrypt policy/violation
  // guardrail and map its verdict to { safe, reasons, blast_radius }.
  throw new Error("Enkrypt destructive-action API not yet wired");
}
