import { describe, expect, it } from "vitest";
import { evaluateHardRules, evaluatePolicy } from "./policy";
import type { ActionProposal, RiskAssessment } from "./types";

const proposal: ActionProposal = {
  actor: "support-agent",
  action: "Add an internal note to ticket #42",
  target: "Helpdesk",
  context: "Customer requested a status update",
  dataSensitivity: "internal",
  reversible: true,
};

const assessment: RiskAssessment = {
  riskLevel: "low",
  summary: "Routine support operation",
  reasons: ["Internal and reversible"],
  sensitiveData: [],
  blastRadius: "single_user",
  recommendedControl: "allow",
};

describe("evaluatePolicy", () => {
  it("allows a routine low-risk action", () => {
    expect(evaluatePolicy(proposal, assessment).decision).toBe("allow");
  });

  it("requires approval for an irreversible action", () => {
    expect(
      evaluatePolicy({ ...proposal, reversible: false }, assessment).decision,
    ).toBe("require_approval");
  });

  it("requires approval for medium risk even when the model recommends allow", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, riskLevel: "medium" }).decision,
    ).toBe("require_approval");
  });

  it("denies an irreversible action on restricted data even when the model says low risk", () => {
    expect(
      evaluatePolicy(
        { ...proposal, reversible: false, dataSensitivity: "restricted" },
        assessment,
      ).decision,
    ).toBe("deny");
  });

  it("requires approval, not denial, for an irreversible action on confidential data", () => {
    expect(
      evaluatePolicy(
        { ...proposal, reversible: false, dataSensitivity: "confidential" },
        assessment,
      ).decision,
    ).toBe("require_approval");
  });

  it("escalates, not denies, a block recommendation with high risk", () => {
    const result = evaluatePolicy(proposal, {
      ...assessment,
      riskLevel: "high",
      recommendedControl: "block",
    });
    expect(result.decision).toBe("require_approval");
    expect(result.rationale.join(" ")).toMatch(/recommended blocking/);
  });

  it("never allows a low-risk action the model recommends blocking", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, recommendedControl: "block" }).decision,
    ).toBe("require_approval");
  });

  it("denies a critical action even when the model recommends allow", () => {
    expect(
      evaluatePolicy(proposal, {
        ...assessment,
        riskLevel: "critical",
        recommendedControl: "allow",
      }).decision,
    ).toBe("deny");
  });

  it("hard rules decide only on declared properties", () => {
    expect(evaluateHardRules(proposal)).toBeUndefined();
    expect(
      evaluateHardRules({ ...proposal, reversible: false, dataSensitivity: "restricted" })
        ?.decision,
    ).toBe("deny");
  });

  it("denies a critical action", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, riskLevel: "critical" }).decision,
    ).toBe("deny");
  });
});
