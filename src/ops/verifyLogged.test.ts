import { describe, expect, it } from "vitest";
import { createDecisionReceipt } from "../domain/receipt";
import type { PolicyDecision } from "../domain/types";
import { toReceiptDoc, type RunDoc, type StepOutcome } from "./receiptLog";
import { createSigner } from "./signing";
import { approveReceipt, receiptMessage } from "./toolGuard";
import { allPassed, checkLoggedReceipt, checkPastedReceipt } from "./verifyLogged";

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

describe("checkPastedReceipt", () => {
  async function signedFile() {
    const { doc, run } = await logged("deny", "refused");
    return { doc, run, text: JSON.stringify({ ...doc, publicKey: run.publicKey }) };
  }

  it("verifies a downloaded receipt against the key in the audit log", async () => {
    const { doc, run, text } = await signedFile();
    const result = await checkPastedReceipt(text, { run: async () => run, receipt: async () => doc });
    expect(result.kind).toBe("signed");
    expect(allPassed(result.checks)).toBe(true);
  });

  it("does not trust a key that only exists inside the file", async () => {
    const { text } = await signedFile();
    const result = await checkPastedReceipt(text, { run: async () => undefined, receipt: async () => undefined });
    expect(result.checks.find((c) => c.id === "origin")?.status).toBe("fail");
    expect(allPassed(result.checks)).toBe(false);
  });

  it("catches a forged receipt signed with the forger's own key", async () => {
    const { doc, run } = await signedFile();
    const { doc: forged, run: forgerRun } = await logged("allow", "executed");
    const text = JSON.stringify({ ...forged, runId: doc.runId, receipt: { ...forged.receipt, id: doc.receipt.id }, publicKey: forgerRun.publicKey });
    const result = await checkPastedReceipt(text, { run: async () => run, receipt: async () => doc });
    expect(result.checks.find((c) => c.id === "origin")?.status).toBe("fail");
    expect(result.checks.find((c) => c.id === "signature")?.status).toBe("fail");
    expect(result.checks.find((c) => c.id === "log-copy")?.status).toBe("fail");
  });

  it("reports an unreachable audit log without pretending to verify", async () => {
    const { text } = await signedFile();
    const offline = async () => { throw new Error("offline"); };
    const result = await checkPastedReceipt(text, { run: offline, receipt: offline });
    expect(result.checks.find((c) => c.id === "origin")?.detail).toMatch(/could not be read \(offline\)/);
    expect(allPassed(result.checks)).toBe(false);
  });

  it("checks a single-action receipt by digest and says it is not signed", async () => {
    const { doc } = await logged("allow", "executed");
    const ok = await checkPastedReceipt(JSON.stringify(doc.receipt), { run: async () => undefined, receipt: async () => undefined });
    expect(ok.kind).toBe("digest-only");
    expect(allPassed(ok.checks)).toBe(true);
    const tampered = await checkPastedReceipt(JSON.stringify({ ...doc.receipt, decision: { decision: "deny", rationale: [] } }), { run: async () => undefined, receipt: async () => undefined });
    expect(allPassed(tampered.checks)).toBe(false);
  });

  it("rejects text that is not a receipt", async () => {
    const lookup = { run: async () => undefined, receipt: async () => undefined };
    await expect(checkPastedReceipt("{nope", lookup)).rejects.toThrow(/not valid JSON/);
    await expect(checkPastedReceipt('{"hello":1}', lookup)).rejects.toThrow(/doesn't look like/);
  });
});
