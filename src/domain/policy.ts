import type { ActionProposal, BlastRadius, GuardDecision, RiskAssessment } from "./types";

const blastLabel: Record<BlastRadius, string> = {
  single_user: "one person",
  team: "one team",
  organization: "the whole organization",
  public: "people outside the company",
};

/**
 * Rules on declared properties only. They run before any model call, so model output
 * cannot downgrade them and they work with no model available at all.
 */
export function evaluateHardRules(proposal: ActionProposal): GuardDecision | undefined {
  if (!proposal.reversible && proposal.dataSensitivity === "restricted") {
    return {
      decision: "deny",
      rationale: ["Touches restricted data and cannot be undone. Blocked by rule, with no model call."],
    };
  }
  return undefined;
}

/** The fail-closed decision when a sensitive action could not be assessed. */
export function escalateUnassessed(proposal: ActionProposal): GuardDecision {
  return {
    decision: "require_approval",
    rationale: [
      `Gemini Nano is not ready on this device, and ${proposal.dataSensitivity} data may not be ` +
        "sent to the cloud, so nothing left the device.",
      "It could not be assessed, so a person has to approve it.",
    ],
  };
}

/** The fail-closed decision when the assessor does not answer in time. */
export function escalateTimedOut(ms: number): GuardDecision {
  return {
    decision: "require_approval",
    rationale: [
      `The assessor did not answer within ${ms / 1000} s, so the call was not assessed.`,
      "A person has to approve it.",
    ],
  };
}

export function evaluatePolicy(
  proposal: ActionProposal,
  assessment: RiskAssessment,
): GuardDecision {
  const hardDecision = evaluateHardRules(proposal);
  if (hardDecision) return hardDecision;

  const rationale: string[] = [];

  if (assessment.riskLevel === "critical") {
    rationale.push("The assessor rated it critical.");
    return { decision: "deny", rationale };
  }

  // A block recommendation without critical risk is self-contradictory model output.
  // It never allows the action; it escalates to a human instead of auto-denying.
  if (assessment.recommendedControl === "block") {
    rationale.push(
      `The assessor recommended blocking but rated it only ${assessment.riskLevel} risk, so a person decides.`,
    );
  }

  // Escalation depends on structured facts only. The model's own "require_approval"
  // recommendation is recorded in the receipt but does not decide: otherwise routine
  // work escalates on vague caution and humans learn to approve without reading.
  if (assessment.riskLevel === "high") {
    rationale.push("The assessor rated it high risk.");
  }

  if (!proposal.reversible && assessment.riskLevel !== "low") {
    rationale.push(`It cannot be undone, and the assessor rated it ${assessment.riskLevel} risk.`);
  }

  if (["confidential", "restricted"].includes(proposal.dataSensitivity)) {
    rationale.push(`It touches ${proposal.dataSensitivity} data, which always needs a person to approve.`);
  }

  if (["organization", "public"].includes(assessment.blastRadius)) {
    rationale.push(`Its impact reaches ${assessment.blastRadius === "public" ? "people outside the company" : "the whole organization"}.`);
  }

  if (rationale.length > 0) {
    return { decision: "require_approval", rationale };
  }

  return {
    decision: "allow",
    rationale: [
      `The assessor rated it ${assessment.riskLevel} risk, affecting ${blastLabel[assessment.blastRadius]}, ` +
        `on ${proposal.dataSensitivity} data${proposal.reversible ? ", and it can be undone" : ""}. ` +
        "Policy allows that without approval.",
    ],
  };
}
