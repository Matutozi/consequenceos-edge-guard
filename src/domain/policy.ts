import type { ActionProposal, GuardDecision, RiskAssessment } from "./types";

export function evaluatePolicy(
  proposal: ActionProposal,
  assessment: RiskAssessment,
): GuardDecision {
  const rationale: string[] = [];

  // Hard rule on declared properties only, so model output cannot downgrade it.
  if (!proposal.reversible && proposal.dataSensitivity === "restricted") {
    rationale.push("Irreversible actions on restricted data are blocked by policy.");
    return { decision: "deny", rationale };
  }

  if (assessment.riskLevel === "critical") {
    rationale.push("The risk assessor rated this action critical.");
    return { decision: "deny", rationale };
  }

  // A block recommendation without critical risk is self-contradictory model output.
  // It never allows the action; it escalates to a human instead of auto-denying.
  if (assessment.recommendedControl === "block") {
    rationale.push(
      `The risk assessor recommended blocking but rated the risk ${assessment.riskLevel}; a human must decide.`,
    );
  }

  if (["medium", "high"].includes(assessment.riskLevel)) {
    rationale.push("Non-routine risk requires accountable human approval.");
  }

  if (!proposal.reversible) {
    rationale.push("The proposed action cannot be automatically reversed.");
  }

  if (["confidential", "restricted"].includes(proposal.dataSensitivity)) {
    rationale.push(`The action handles ${proposal.dataSensitivity} data.`);
  }

  if (["organization", "public"].includes(assessment.blastRadius)) {
    rationale.push("The potential blast radius extends beyond a single team.");
  }

  if (assessment.recommendedControl === "require_approval") {
    rationale.push("The risk assessor recommends human approval.");
  }

  if (rationale.length > 0) {
    return { decision: "require_approval", rationale };
  }

  return {
    decision: "allow",
    rationale: ["Routine, reversible, low-impact action within the configured policy."],
  };
}
