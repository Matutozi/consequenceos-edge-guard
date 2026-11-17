import { canonicalJson, verifyReceipt } from "../domain/receipt";
import type { ReceiptDoc, RunDoc } from "./receiptLog";
import { verifyWithPublicKey } from "./signing";
import { approvalMessage, receiptMessage } from "./toolGuard";

export type CheckStatus = "pass" | "fail" | "not-applicable";

export interface Check {
  id: "digest" | "signature" | "binding" | "approval" | "outcome";
  label: string;
  status: CheckStatus;
  detail: string;
}

/**
 * Checks a receipt read back from the audit log, using only what the log holds:
 * the receipt, its signature, the approval, the outcome, and the run's public key.
 */
export async function checkLoggedReceipt(doc: ReceiptDoc, run: RunDoc | undefined): Promise<Check[]> {
  const { receipt } = doc;
  const checks: Check[] = [];

  const digestOk = await verifyReceipt(receipt);
  checks.push({
    id: "digest",
    label: "Contents match the digest",
    status: digestOk ? "pass" : "fail",
    detail: digestOk
      ? "SHA-256 over the receipt's canonical JSON matches its recorded digest."
      : "The receipt was changed after it was issued: its contents no longer match its digest.",
  });

  // Signatures cover the digest. If the contents no longer match it, a valid signature
  // vouches for the original receipt, not this one, so it must not count as a pass.
  const signatureValid = run
    ? await verifyWithPublicKey(run.publicKey, receiptMessage(receipt), doc.signature)
    : false;
  const signatureOk = signatureValid && digestOk;
  checks.push({
    id: "signature",
    label: "Signed by the run's Edge Guard key",
    status: signatureOk ? "pass" : "fail",
    detail: !run
      ? "The run this receipt names is not in the audit log, so there is no key to check it against."
      : !signatureValid
        ? "The signature does not verify with this run's public key."
        : !digestOk
          ? "The signature is valid for the original digest, but this receipt's contents no longer match it, so the signature does not cover them."
          : "The ECDSA P-256 signature over the digest verifies with the public key this run recorded.",
  });

  checks.push({
    id: "binding",
    label: "Bound to one exact call",
    status: receipt.toolCall ? "pass" : "fail",
    detail: receipt.toolCall
      ? `Authorizes only ${receipt.toolCall.tool}(${canonicalJson(receipt.toolCall.args)}). The executor refuses any other arguments.`
      : "The receipt does not name a tool call, so no executor should accept it.",
  });

  const needsApproval = receipt.decision.decision === "require_approval";
  let approvalOk = false;
  if (doc.approval) {
    approvalOk =
      digestOk &&
      doc.approval.receiptId === receipt.id &&
      !!run &&
      (await verifyWithPublicKey(
        run.publicKey,
        approvalMessage(receipt, doc.approval.approvedBy, doc.approval.approvedAt),
        doc.approval.signature,
      ));
  }
  checks.push({
    id: "approval",
    label: "Human approval",
    status: !needsApproval && !doc.approval ? "not-applicable" : approvalOk ? "pass" : doc.approval ? "fail" : "not-applicable",
    detail: !needsApproval && !doc.approval
      ? "Not needed: Edge Guard did not escalate this call."
      : approvalOk
        ? `Approved by ${doc.approval!.approvedBy} at ${doc.approval!.approvedAt}; the approval signature verifies.`
        : doc.approval
          ? digestOk
            ? "An approval is recorded, but its signature does not verify for this receipt."
            : "An approval is recorded for the original receipt, but this receipt's contents no longer match it."
          : "Escalated, and no approval was recorded.",
  });

  const decision = receipt.decision.decision;
  const outcomeProblem =
    doc.outcome === "executed" && decision === "deny"
      ? "It ran although Edge Guard denied it."
      : doc.outcome === "executed" && decision === "require_approval" && !approvalOk
        ? "It ran although it was escalated and has no valid approval."
        : doc.outcome === "rejected" && decision !== "require_approval"
          ? "A human rejected a call that was never escalated."
          : undefined;
  checks.push({
    id: "outcome",
    label: "Outcome is consistent with the decision",
    status: outcomeProblem ? "fail" : "pass",
    detail: outcomeProblem ?? `Decision ${decision.replace("_", " ")}, outcome ${doc.outcome}.`,
  });

  return checks;
}

export const allPassed = (checks: Check[]) => checks.every((c) => c.status !== "fail");
