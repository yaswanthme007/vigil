import "../env";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { scanDestructive } from "../guardrails/enkrypt";

/**
 * estimateBlastRadius — scores the potential impact (0-100) of applying a
 * remediation, before it runs. Combines how many services it touches, the
 * runbook's declared risk level, and any destructive signals in the plan text.
 * Also reports whether the action is reversible. Used by the Propose Remediation
 * step and surfaced in the dashboard's blast-radius meter.
 */

const RISK_POINTS: Record<string, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 45,
};

export const estimateBlastRadius = createTool({
  id: "estimate-blast-radius",
  description:
    "Estimate the blast radius (0-100 impact score) of a proposed remediation before it is applied, based on affected services, runbook risk level, and destructive signals in the plan. Returns the score, the affected services, whether the action is reversible, and the reasons behind the score.",
  inputSchema: z.object({
    remediation: z
      .string()
      .describe("The remediation plan text (steps + rollback)."),
    affected_services: z
      .array(z.string())
      .optional()
      .describe("Services this remediation would touch."),
    risk_level: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Declared risk level of the source runbook, if known."),
  }),
  outputSchema: z.object({
    score: z.number().min(0).max(100),
    affected_services: z.array(z.string()),
    reversible: z.boolean(),
    reasons: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const { remediation, affected_services = [], risk_level } = context;
    const reasons: string[] = [];

    let score = 0;

    // 1. Breadth: up to 5 services counted, 10 pts each (cap 50).
    const serviceCount = Math.min(affected_services.length, 5);
    if (serviceCount > 0) {
      const pts = serviceCount * 10;
      score += pts;
      reasons.push(
        `${affected_services.length} service(s) affected (+${pts})`
      );
    }

    // 2. Declared runbook risk level.
    if (risk_level) {
      const pts = RISK_POINTS[risk_level] ?? 0;
      score += pts;
      reasons.push(`runbook risk level "${risk_level}" (+${pts})`);
    }

    // 3. Destructive signals in the plan text.
    const destructive = scanDestructive(remediation);
    let irreversible = false;
    for (const d of destructive) {
      const pts = d.reversible ? 15 : 30;
      score += pts;
      if (!d.reversible) irreversible = true;
      reasons.push(`destructive: ${d.reason} (+${pts})`);
    }

    score = Math.min(100, Math.round(score));
    const reversible = !irreversible;
    if (reasons.length === 0) reasons.push("no significant impact signals");

    return { score, affected_services, reversible, reasons };
  },
});
