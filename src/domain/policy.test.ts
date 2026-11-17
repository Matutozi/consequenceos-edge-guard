import { describe, expect, it } from "vitest";
import { escalateTimedOut, evaluateHardRules, evaluatePolicy } from "./policy";
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

  it("allows a low-risk irreversible action with narrow impact", () => {
    expect(
      evaluatePolicy({ ...proposal, reversible: false }, assessment).decision,
    ).toBe("allow");
  });

  it("requires approval for an irreversible action rated above low", () => {
    expect(
      evaluatePolicy({ ...proposal, reversible: false }, { ...assessment, riskLevel: "medium" })
        .decision,
    ).toBe("require_approval");
  });

  it("allows a reversible medium-risk action on internal data with narrow impact", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, riskLevel: "medium" }).decision,
    ).toBe("allow");
  });

  it("does not escalate only because the model recommends approval", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, recommendedControl: "require_approval" }).decision,
    ).toBe("allow");
  });

  it("requires approval for high risk", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, riskLevel: "high" }).decision,
    ).toBe("require_approval");
  });

  it("requires approval for organization-wide impact", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, blastRadius: "organization" }).decision,
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

  it("allows a reversible, low-impact defensive action rated low risk", () => {
    const defensive = { ...proposal, action: "revoke_sessions({\"userId\":\"ada.okafor\"})", reversible: true };
    const result = evaluatePolicy(defensive, { ...assessment, summary: "Routine containment" });
    expect(result.decision).toBe("allow");
    expect(result.rationale[0]).toMatch(/one person/);
  });

  it("escalates a timed-out assessment, naming the deadline", () => {
    const result = escalateTimedOut(20_000);
    expect(result.decision).toBe("require_approval");
    expect(result.rationale[0]).toMatch(/20 s/);
  });

  it("denies a critical action", () => {
    expect(
      evaluatePolicy(proposal, { ...assessment, riskLevel: "critical" }).decision,
    ).toBe("deny");
  });
});
