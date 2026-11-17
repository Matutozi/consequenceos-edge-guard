import { describe, expect, it } from "vitest";
import { canonicalJson, createDecisionReceipt, verifyReceipt } from "./receipt";
import type { ActionProposal, AnalysisResult, GuardDecision } from "./types";

const proposal: ActionProposal = {
  actor: "support-agent",
  action: "Add an internal note to ticket #42",
  target: "Helpdesk",
  context: "Customer requested a status update",
  dataSensitivity: "internal",
  reversible: true,
};

const analysis: AnalysisResult = {
  assessment: {
    riskLevel: "low",
    summary: "Routine support operation",
    reasons: ["Internal and reversible"],
    sensitiveData: [],
    blastRadius: "single_user",
    recommendedControl: "allow",
  },
  inferenceSource: "ON_DEVICE",
};

const decision: GuardDecision = { decision: "allow", rationale: ["Routine."] };

describe("decision receipt", () => {
  it("verifies a receipt exactly as it would be downloaded", async () => {
    const receipt = await createDecisionReceipt(proposal, analysis, decision);
    const downloaded = JSON.parse(JSON.stringify(receipt, null, 2));
    expect(await verifyReceipt(downloaded)).toBe(true);
  });

  it("detects a modified decision", async () => {
    const receipt = await createDecisionReceipt(proposal, analysis, decision);
    const tampered = {
      ...receipt,
      decision: { ...receipt.decision, decision: "deny" as const },
    };
    expect(await verifyReceipt(tampered)).toBe(false);
  });

  it("detects a modified inference source", async () => {
    const receipt = await createDecisionReceipt(proposal, analysis, decision);
    expect(await verifyReceipt({ ...receipt, inferenceSource: "IN_CLOUD" })).toBe(false);
  });

  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: [2, { e: 0, f: 1 }] }, b: 1 }),
    );
  });
});
