/**
 * Attribution helpers for the Safety Gate.
 *
 * Every blocked reason is tagged at its source with a "[POLICY]" or "[ENKRYPT]"
 * prefix. The banner and seal must describe the block using the sources that are
 * ACTUALLY present — never claim Enkrypt blocked something its scan scored safe.
 */

export type ReasonSource = "POLICY" | "ENKRYPT" | "OTHER";

export interface ParsedReason {
  source: ReasonSource;
  text: string;
}

export function parseReason(reason: string): ParsedReason {
  const m = reason.match(/^\[(POLICY|ENKRYPT)\]\s*(.*)$/);
  if (m) return { source: m[1] as ReasonSource, text: m[2] };
  return { source: "OTHER", text: reason };
}

/** The lead sentence, derived from the sources present in the reasons. */
export function blockedLead(reasons: string[]): string {
  const sources = new Set(reasons.map((r) => parseReason(r).source));
  const hasPolicy = sources.has("POLICY");
  const hasEnkrypt = sources.has("ENKRYPT");

  if (hasPolicy && hasEnkrypt) {
    return "Blocked by Vigil's destructive-action policy and Enkrypt's threat scan.";
  }
  if (hasEnkrypt) {
    return "Enkrypt's threat scan blocked this remediation.";
  }
  if (hasPolicy) {
    return "Vigil's destructive-action policy blocked this remediation.";
  }
  return "The Safety Gate blocked this remediation.";
}

/** Seal subtitle naming the source(s) — never claims Enkrypt blocked something
 *  its scan scored safe. The seal's title always reads "SAFETY GATE". */
export function blockedSubtitle(reasons: string[]): string {
  const sources = new Set(reasons.map((r) => parseReason(r).source));
  const hasPolicy = sources.has("POLICY");
  const hasEnkrypt = sources.has("ENKRYPT");

  if (hasPolicy && hasEnkrypt) {
    return "destructive-action policy + Enkrypt threat scan";
  }
  if (hasEnkrypt) {
    return "Enkrypt threat scan";
  }
  // POLICY only, or an untagged reason, is Vigil's own rule.
  return "destructive-action policy";
}

/** Short legend for the seal's lower ring, derived from the sources present.
 *  Like blockedSubtitle, it never names Enkrypt unless Enkrypt actually flagged
 *  the remediation. POLICY-only reads "VIGIL POLICY"; Enkrypt-only reads
 *  "ENKRYPT THREAT SCAN"; both read "ENKRYPT · VIGIL POLICY". */
export function blockedGateArc(reasons: string[]): string {
  const sources = new Set(reasons.map((r) => parseReason(r).source));
  const hasPolicy = sources.has("POLICY");
  const hasEnkrypt = sources.has("ENKRYPT");

  if (hasPolicy && hasEnkrypt) return "ENKRYPT · VIGIL POLICY";
  if (hasEnkrypt) return "ENKRYPT THREAT SCAN";
  return "VIGIL POLICY";
}

export const BLOCKED_TAIL =
  "It cannot be approved — reject or escalate to a human.";

/** Full banner text: attributed lead + the fixed refusal tail. */
export function blockedByText(reasons: string[]): string {
  return `${blockedLead(reasons)} ${BLOCKED_TAIL}`;
}
