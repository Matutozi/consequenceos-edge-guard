import { canonicalJson, verifyReceipt } from "../domain/receipt";
import type { ReceiptDoc, RunDoc } from "./receiptLog";
import { verifyWithPublicKey } from "./signing";
import { fingerprint, formatFingerprint, type ApproverDoc } from "./approvals";
import { approvalMessage, receiptMessage } from "./toolGuard";

export type CheckStatus = "pass" | "fail" | "not-applicable";

export interface Check {
  id: "origin" | "log-copy" | "digest" | "signature" | "binding" | "approval" | "outcome";
  label: string;
  status: CheckStatus;
  detail: string;
}

/**
 * Checks a receipt read back from the audit log, using only what the log holds:
 * the receipt, its signature, the approval, the outcome, and the run's public key.
 */
/**
 * @param approver the registered key of the phone that signed the approval, when the
 *   approval names one (`approval.keyId`). Without it, a phone approval cannot be checked.
 */
export async function checkLoggedReceipt(
  doc: ReceiptDoc,
  run: RunDoc | undefined,
  approver?: ApproverDoc,
): Promise<Check[]> {
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
  const byPhone = !!doc.approval?.keyId;
  if (doc.approval) {
    // A phone signs with its own Keystore key; everything else with the run's key.
    const key = byPhone ? approver?.publicKey : run?.publicKey;
    approvalOk =
      digestOk &&
      doc.approval.receiptId === receipt.id &&
      !!key &&
      (!byPhone || (await fingerprint(key)) === doc.approval.keyId) &&
      (await verifyWithPublicKey(
        key,
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
        ? `Approved by ${doc.approval!.approvedBy} at ${doc.approval!.approvedAt}${byPhone ? `, on a phone with key ${formatFingerprint(doc.approval!.keyId!)}` : ""}; the approval signature verifies.`
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

export interface PastedCheck {
  /** "signed": a console receipt with a signature. "digest-only": a single-action receipt. */
  kind: "signed" | "digest-only";
  checks: Check[];
  receipt: ReceiptDoc["receipt"];
}

/** Reads from the audit log. Each may reject, for example when Firestore is unreachable. */
export interface AuditLookup {
  run(runId: string): Promise<RunDoc | undefined>;
  /** A phone's registered key, for approvals signed on a phone. Optional. */
  approver?(keyId: string): Promise<ApproverDoc | undefined>;
  receipt(id: string): Promise<ReceiptDoc | undefined>;
}

const sameKey = (a: JsonWebKey, b: JsonWebKey) => a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;

/**
 * Checks a receipt someone pasted or uploaded. A signature proves origin only when
 * the key comes from the audit log: a key inside the file proves nothing, since
 * anyone can generate a key pair and sign a forged receipt with it.
 */
export async function checkPastedReceipt(text: string, lookup: AuditLookup): Promise<PastedCheck> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const value = (parsed ?? {}) as Record<string, unknown>;

  // A single-action receipt: digest only, no signature.
  if (typeof value.digest === "string" && value.proposal && !value.signature) {
    const receipt = value as unknown as ReceiptDoc["receipt"];
    const digestOk = await verifyReceipt(receipt);
    return {
      kind: "digest-only",
      receipt,
      checks: [
        {
          id: "digest",
          label: "Contents match the digest",
          status: digestOk ? "pass" : "fail",
          detail: digestOk
            ? "SHA-256 over the receipt's canonical JSON matches its digest."
            : "The receipt was changed: its contents no longer match its digest.",
        },
        {
          id: "signature",
          label: "Signature",
          status: "not-applicable",
          detail:
            "This receipt is not signed. Receipts from the single action view carry a digest, which catches " +
            "accidental edits but not deliberate ones: anyone can change the contents and recompute it.",
        },
      ],
    };
  }

  if (!value.receipt || typeof value.signature !== "string" || typeof value.runId !== "string") {
    throw new Error("This doesn't look like an Edge Guard receipt: it needs receipt, signature and runId fields.");
  }
  const doc = value as unknown as ReceiptDoc & { publicKey?: JsonWebKey };
  const fileKey = doc.publicKey;

  let loggedRun: RunDoc | undefined;
  let loggedCopy: ReceiptDoc | undefined;
  let lookupError = "";
  try {
    [loggedRun, loggedCopy] = await Promise.all([lookup.run(doc.runId), lookup.receipt(doc.receipt.id)]);
  } catch (caught) {
    lookupError = caught instanceof Error ? caught.message : "The audit log could not be read.";
  }

  const origin: Check = loggedRun
    ? fileKey && !sameKey(fileKey, loggedRun.publicKey)
      ? { id: "origin", label: "Key comes from the audit log", status: "fail", detail: "The public key in the file is not the one this run recorded in the audit log. Checked against the logged key instead." }
      : { id: "origin", label: "Key comes from the audit log", status: "pass", detail: "Checked against the public key this run recorded in the audit log, not a key from the file." }
    : {
        id: "origin",
        label: "Key comes from the audit log",
        status: "fail",
        detail:
          (lookupError ? `The audit log could not be read (${lookupError}). ` : "This run is not in the audit log. ") +
          (fileKey
            ? "The signature was checked against the key inside the file, which anyone could have generated, so it proves nothing about who issued the receipt."
            : "There is no key to check the signature against."),
      };

  const logCopy: Check = loggedCopy
    ? loggedCopy.receipt.digest === doc.receipt.digest && loggedCopy.signature === doc.signature
      ? { id: "log-copy", label: "Matches the audit log copy", status: "pass", detail: "The audit log holds the same receipt and signature." }
      : { id: "log-copy", label: "Matches the audit log copy", status: "fail", detail: "The audit log holds a different version of this receipt." }
    : { id: "log-copy", label: "Matches the audit log copy", status: lookupError ? "not-applicable" : "fail", detail: lookupError ? "The audit log could not be read." : "No receipt with this ID is in the audit log." };

  const key = loggedRun?.publicKey ?? fileKey;
  const approver = doc.approval?.keyId && lookup.approver ? await lookup.approver(doc.approval.keyId).catch(() => undefined) : undefined;
  const checks = await checkLoggedReceipt(doc, key ? { agent: "", planner: "live", publicKey: key } : undefined, approver);
  return { kind: "signed", receipt: doc.receipt, checks: [origin, logCopy, ...checks] };
}
