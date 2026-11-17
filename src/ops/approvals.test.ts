import { beforeAll, describe, expect, it } from "vitest";
import { createDecisionReceipt } from "../domain/receipt";
import type { DecisionReceipt } from "../domain/types";
import { fingerprint, formatFingerprint, rejectionMessage, toApproval, verifyResponse, type ApprovalResponseDoc, type ApproverDoc } from "./approvals";
import { Executor } from "./executor";
import { initialNorthwindState, northwindTools } from "./northwind";
import { toReceiptDoc } from "./receiptLog";
import { createSigner } from "./signing";
import { approvalMessage, receiptMessage } from "./toolGuard";
import { checkLoggedReceipt } from "./verifyLogged";

/** Stands in for the Android app: an ECDSA P-256 key and raw (r || s) hex signatures. */
async function phone(approverId = "mei.lin") {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  delete publicKey.key_ops;
  delete publicKey.ext;
  const approver: ApproverDoc = { approverId, name: "Mei Lin", role: "IT administrator", platform: "android", publicKey };
  const sign = async (message: string) =>
    [...new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(message)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return { approver, keyId: await fingerprint(publicKey), sign };
}

let receipt: DecisionReceipt;
let guardSigner: Awaited<ReturnType<typeof createSigner>>;
beforeAll(async () => {
  guardSigner = await createSigner();
  receipt = await createDecisionReceipt(
    { actor: "a", action: "disable_user", target: "idp", context: "c", dataSensitivity: "confidential", reversible: true },
    { assessment: null, inferenceSource: "NONE" },
    { decision: "require_approval", rationale: ["confidential"] },
    { tool: "disable_user", args: { userId: "ada.okafor" } },
  );
});

async function answer(p: Awaited<ReturnType<typeof phone>>, decision: "approve" | "reject" = "approve"): Promise<ApprovalResponseDoc> {
  const decidedAt = "2026-11-18T09:00:00.000Z";
  const message = decision === "approve" ? approvalMessage(receipt, "mei.lin", decidedAt) : rejectionMessage(receipt, "mei.lin", decidedAt);
  return { receiptId: receipt.id, decision, approverId: "mei.lin", keyId: p.keyId, decidedAt, signature: await p.sign(message), explanation: null };
}

describe("fingerprints", () => {
  it("are 16 hex characters, stable for a key, shown in groups of four", async () => {
    const p = await phone();
    expect(p.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(await fingerprint(p.approver.publicKey)).toBe(p.keyId);
    expect(formatFingerprint("ab12cd34ef567890")).toBe("AB12 CD34 EF56 7890");
  });
});

describe("verifyResponse", () => {
  it("accepts an approval signed by the paired phone", async () => {
    const p = await phone();
    expect(await verifyResponse(receipt, await answer(p), p.approver)).toBe(true);
  });

  it("accepts a signed rejection, and refuses an approval signature passed off as a rejection", async () => {
    const p = await phone();
    expect(await verifyResponse(receipt, await answer(p, "reject"), p.approver)).toBe(true);
    const approved = await answer(p, "approve");
    expect(await verifyResponse(receipt, { ...approved, decision: "reject" }, p.approver)).toBe(false);
  });

  it("refuses an answer from another phone, even one claiming to be Mei Lin", async () => {
    const paired = await phone();
    const impostor = await phone();
    const forged = { ...(await answer(impostor)), keyId: paired.keyId };
    expect(await verifyResponse(receipt, forged, paired.approver)).toBe(false);
    expect(await verifyResponse(receipt, await answer(impostor), paired.approver)).toBe(false);
  });

  it("refuses an answer whose time or receipt was changed", async () => {
    const p = await phone();
    const a = await answer(p);
    expect(await verifyResponse(receipt, { ...a, decidedAt: "2026-11-18T09:00:01.000Z" }, p.approver)).toBe(false);
    expect(await verifyResponse(receipt, { ...a, receiptId: "other" }, p.approver)).toBe(false);
  });
});

describe("executor with phone approvals", () => {
  const call = { tool: "disable_user", args: { userId: "ada.okafor" } };

  it("refuses a phone approval unless a verifier vouches for the phone", async () => {
    const p = await phone();
    const signed = { receipt, signature: await guardSigner.sign(receiptMessage(receipt)) };
    const approval = toApproval(await answer(p));
    await expect(new Executor(guardSigner.verify, northwindTools).execute(initialNorthwindState(), call, signed, approval)).rejects.toThrow(/human approval/);

    const withPhone = new Executor(guardSigner.verify, northwindTools, async (r, a) =>
      verifyResponse(r, { ...(await answer(p)), signature: a.signature, decidedAt: a.approvedAt }, p.approver),
    );
    const result = await withPhone.execute(initialNorthwindState(), call, signed, approval);
    expect(result.state.users.find((u) => u.id === "ada.okafor")?.status).toBe("disabled");
  });
});

describe("audit verification of phone approvals", () => {
  it("checks the approval against the phone's key, not the run's", async () => {
    const p = await phone();
    const signed = { receipt, signature: await guardSigner.sign(receiptMessage(receipt)) };
    const doc = JSON.parse(JSON.stringify(toReceiptDoc("run", signed, toApproval(await answer(p)), "executed")));
    const run = { agent: "a", planner: "live" as const, publicKey: await guardSigner.publicKeyJwk() };
    const status = async (approver?: ApproverDoc) => (await checkLoggedReceipt(doc, run, approver)).find((c) => c.id === "approval")?.status;
    expect(await status(p.approver)).toBe("pass");
    expect(await status(undefined)).toBe("fail");
    expect(await status((await phone()).approver)).toBe("fail");
  });
});
