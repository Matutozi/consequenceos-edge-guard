import { describe, expect, it } from "vitest";
import { createDecisionReceipt } from "../domain/receipt";
import type { PolicyDecision } from "../domain/types";
import { toReceiptDoc, type RunDoc, type StepOutcome } from "./receiptLog";
import { createSigner } from "./signing";
import { approveReceipt, receiptMessage } from "./toolGuard";
import { allPassed, checkLoggedReceipt } from "./verifyLogged";

async function logged(decision: PolicyDecision, outcome: StepOutcome, approve = false) {
  const signer = await createSigner();
  const receipt = await createDecisionReceipt(
    { actor: "a", action: "x", target: "t", context: "c", dataSensitivity: "internal", reversible: true },
    { assessment: null, inferenceSource: "NONE" },
    { decision, rationale: ["r"] },
    { tool: "disable_user", args: { userId: "ada.okafor" } },
  );
  const signed = { receipt, signature: await signer.sign(receiptMessage(receipt)) };
  const approval = approve ? await approveReceipt(signed, "mei.lin", signer) : undefined;
  const run: RunDoc = { agent: "a", planner: "recorded", publicKey: await signer.publicKeyJwk() };
  // Round-trip like a Firestore read.
  return { doc: JSON.parse(JSON.stringify(toReceiptDoc("run", signed, approval, outcome))), run };
}

const status = (checks: Awaited<ReturnType<typeof checkLoggedReceipt>>, id: string) =>
  checks.find((c) => c.id === id)?.status;

describe("checkLoggedReceipt", () => {
  it("passes an allowed, executed receipt", async () => {
    const { doc, run } = await logged("allow", "executed");
    const checks = await checkLoggedReceipt(doc, run);
    expect(allPassed(checks)).toBe(true);
    expect(status(checks, "approval")).toBe("not-applicable");
  });

  it("passes an escalated receipt with a valid approval", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    const checks = await checkLoggedReceipt(doc, run);
    expect(allPassed(checks)).toBe(true);
    expect(status(checks, "approval")).toBe("pass");
  });

  it("detects a decision changed after logging", async () => {
    const { doc, run } = await logged("deny", "refused");
    doc.receipt.decision.decision = "allow";
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "digest")).toBe("fail");
    // The signature is valid for the original digest but must not vouch for changed contents.
    expect(status(checks, "signature")).toBe("fail");
    expect(allPassed(checks)).toBe(false);
  });

  it("does not count an approval for a receipt whose contents changed", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    doc.receipt.toolCall.args.userId = "everyone";
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "approval")).toBe("fail");
    expect(status(checks, "outcome")).toBe("fail");
  });

  it("detects a digest recomputed by a forger, through the signature", async () => {
    const { doc, run } = await logged("deny", "refused");
    const forged = await createDecisionReceipt(doc.receipt.proposal, doc.receipt, { decision: "allow", rationale: [] }, doc.receipt.toolCall);
    const checks = await checkLoggedReceipt({ ...doc, receipt: { ...forged, id: doc.receipt.id } }, run);
    expect(status(checks, "signature")).toBe("fail");
  });

  it("fails a receipt checked against another run's key", async () => {
    const { doc } = await logged("allow", "executed");
    const { run: otherRun } = await logged("allow", "executed");
    expect(status(await checkLoggedReceipt(doc, otherRun), "signature")).toBe("fail");
  });

  it("fails when the run is missing", async () => {
    const { doc } = await logged("allow", "executed");
    expect(status(await checkLoggedReceipt(doc, undefined), "signature")).toBe("fail");
  });

  it("flags a denied call that executed", async () => {
    const { doc, run } = await logged("deny", "executed");
    expect(status(await checkLoggedReceipt(doc, run), "outcome")).toBe("fail");
  });

  it("flags an escalated call that executed without approval", async () => {
    const { doc, run } = await logged("require_approval", "executed");
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "outcome")).toBe("fail");
  });

  it("fails an approval whose signature does not verify", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    doc.approval.approvedBy = "someone.else";
    expect(status(await checkLoggedReceipt(doc, run), "approval")).toBe("fail");
  });
});
