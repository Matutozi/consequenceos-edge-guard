import { evaluatePolicy } from "../domain/policy";
import type { PolicyConfig } from "../domain/policyConfig";
import type { PolicyDecision, RiskAssessment } from "../domain/types";
import { lookupTool, type ToolRegistry } from "../ops/registry";
import { decideByRules, toProposal } from "../ops/toolGuard";
import { evalCases, evalTools, type EvalCase } from "./cases";
import { score, type EvalResult } from "./runEvals";

/** A full set of adjustable rules: what the Policy page edits. */
export interface PolicyDraft {
  registry: ToolRegistry;
  internalDomains: string[];
  policy: PolicyConfig;
}

/** Recorded model assessments by case ID, from an eval run. */
export interface AssessmentSet {
  route: "cloud" | "device" | "hybrid";
  model: string;
  date: string;
  assessments: Record<string, RiskAssessment>;
}

export type PreviewVerdict = "pass" | "stricter" | "false-allow" | "needs-assessment";

export interface PreviewRow {
  case: EvalCase;
  decision?: PolicyDecision;
  verdict: PreviewVerdict;
  decidedBy: "rule" | "assessor" | "none";
  reason?: string;
}

/**
 * Decides every eval case under a draft, with no model calls: rules run as they
 * would live, and judgement cases reuse a recorded assessment. Policy changes what
 * is done with an assessment, not the assessment itself, so this is exact for every
 * case that has one. A case with no recorded assessment is reported, never guessed.
 */
export function previewDraft(draft: PolicyDraft, recorded: Record<string, RiskAssessment>, cases: EvalCase[] = evalCases): PreviewRow[] {
  // Eval-only tools are not part of the draft; the draft's own tools take their place.
  const registry = { ...draft.registry, ...evalTools };
  return cases.map((c) => {
    const call = { tool: c.tool, args: c.args, reason: c.reason };
    const ruled = decideByRules(call, registry, draft.internalDomains, draft.policy);
    if (ruled) {
      return { case: c, decision: ruled.decision, verdict: score(c.expected, ruled.decision), decidedBy: "rule", reason: ruled.rationale[0] };
    }
    const assessment = recorded[c.id];
    if (!assessment) return { case: c, verdict: "needs-assessment", decidedBy: "none" };
    const proposal = toProposal({ agent: "eval-agent", tool: c.tool, args: c.args, reason: c.reason }, lookupTool(registry, c.tool));
    const decided = evaluatePolicy(proposal, assessment, draft.policy);
    return { case: c, decision: decided.decision, verdict: score(c.expected, decided.decision), decidedBy: "assessor", reason: decided.rationale[0] };
  });
}

export interface PreviewSummary {
  scored: number;
  pass: number;
  falseAllows: number;
  stricter: number;
  needsAssessment: number;
}

export function summarizePreview(rows: PreviewRow[]): PreviewSummary {
  const count = (v: PreviewVerdict) => rows.filter((r) => r.verdict === v).length;
  return {
    scored: rows.length - count("needs-assessment"),
    pass: count("pass"),
    falseAllows: count("false-allow"),
    stricter: count("stricter"),
    needsAssessment: count("needs-assessment"),
  };
}

/** Collects the assessments from an eval run, for the Policy page. */
export function assessmentsFrom(results: EvalResult[]): Record<string, RiskAssessment> {
  const out: Record<string, RiskAssessment> = {};
  for (const r of results) if (r.assessment && r.verdict !== "not-assessed" && r.verdict !== "error") out[r.case.id] = r.assessment;
  return out;
}
