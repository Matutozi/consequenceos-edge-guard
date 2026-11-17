import { describe, expect, it } from "vitest";
import { createDecisionReceipt } from "../domain/receipt";
import { toReceiptDoc } from "./receiptLog";
import { createSigner, verifyWithPublicKey } from "./signing";
import { approveReceipt, receiptMessage } from "./toolGuard";

async function signedReceipt() {
  const signer = await createSigner();
  const receipt = await createDecisionReceipt(
    { actor: "a", action: "x", target: "t", context: "c", dataSensitivity: "confidential", reversible: true },
    { assessment: null, inferenceSource: "NONE" },
    { decision: "require_approval", rationale: ["r"] },
    { tool: "disable_user", args: { userId: "ada.okafor" } },
  );
  return { signer, signed: { receipt, signature: await signer.sign(receiptMessage(receipt)) } };
}

describe("audit log documents", () => {
  it("match the shapes firestore.rules accepts", async () => {
    const { signer, signed } = await signedReceipt();
    const approval = await approveReceipt(signed, "mei.lin", signer);
    const doc = toReceiptDoc("11111111-2222-4333-8444-555555555555", signed, approval, "executed");
    expect(Object.keys(doc).sort()).toEqual(["approval", "outcome", "receipt", "runId", "signature"]);
    expect(doc.receipt.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(doc.approval?.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.stringify(doc)).not.toContain("undefined");
  });

  it("stores null, not undefined, when there is no approval", async () => {
    const { signed } = await signedReceipt();
    expect(toReceiptDoc("run", signed, undefined, "refused").approval).toBeNull();
  });

  it("can be verified later from the exported public key alone", async () => {
    const { signer, signed } = await signedReceipt();
    const jwk = await signer.publicKeyJwk();
    expect(jwk).not.toHaveProperty("d");
    expect(await verifyWithPublicKey(jwk, receiptMessage(signed.receipt), signed.signature)).toBe(true);
    const other = await (await createSigner()).publicKeyJwk();
    expect(await verifyWithPublicKey(other, receiptMessage(signed.receipt), signed.signature)).toBe(false);
  });
});
