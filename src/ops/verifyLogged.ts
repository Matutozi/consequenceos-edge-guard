import { canonicalJson, verifyReceipt } from "../domain/receipt";
import { entryMessage, type ReceiptDoc, type RunDoc } from "./receiptLog";
import { verifyWithPublicKey } from "./signing";
import { fingerprint, formatFingerprint, type ApproverDoc } from "./approvals";
import { approvalMessage, receiptMessage } from "./toolGuard";

export type CheckStatus = "pass" | "fail" | "not-applicable";

export interface Check {
  id: "origin" | "log-copy" | "digest" | "signature" | "binding" | "approval" | "outcome" | "entry" | "unique";
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
/**
 * @param rivalRuns other runs whose own, validly signed entries claim this receipt ID.
 *   Normally empty; anything else means one of them is a copy.
 */
export async function checkLoggedReceipt(
  doc: ReceiptDoc,
  run: RunDoc | undefined,
  approver?: ApproverDoc,
  rivalRuns: string[] = [],
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
    // When the contents no longer match the digest, the call they name can't be trusted,
    // so this is not checked rather than shown as passing.
    status: !receipt.toolCall ? "fail" : digestOk ? "pass" : "not-applicable",
    detail: !receipt.toolCall
      ? "The receipt does not name a tool call, so no executor should accept it."
      : digestOk
        ? `Authorizes only ${receipt.toolCall.tool}(${canonicalJson(receipt.toolCall.args)}). The executor refuses any other arguments.`
        : "Not checked: the contents were changed, so the call they name can't be trusted.",
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
    status: !digestOk ? "not-applicable" : outcomeProblem ? "fail" : "pass",
    detail: !digestOk
      ? "Not checked: the decision in this copy was changed after it was issued, so there is nothing trustworthy to compare the outcome with."
      : (outcomeProblem ?? `Decision ${decision.replace("_", " ")}, outcome ${doc.outcome}.`),
  });

  // The outcome and approval above are only claims until the run's key vouches for them:
  // the receipt is public before it is logged, so anyone could log it with another outcome.
  // Like the signature check, it vouches for nothing when the contents no longer match the digest.
  const entryOk =
    digestOk &&
    !!run &&
    !!doc.outcomeSignature &&
    (await verifyWithPublicKey(run.publicKey, entryMessage(doc), doc.outcomeSignature));
  checks.push({
    id: "entry",
    label: "Outcome signed by the run's key",
    status: entryOk ? "pass" : !digestOk && doc.outcomeSignature ? "not-applicable" : "fail",
    detail: entryOk
      ? "The run's key signed this receipt's outcome and approval when it logged them."
      : !digestOk && doc.outcomeSignature
        ? "Not checked: the receipt's contents were changed, so a signature over its digest does not cover them."
        : !doc.outcomeSignature
        ? "This entry's outcome and approval are not signed (it was logged before entries were signed, or by someone else), so they cannot be trusted."
        : !run
          ? "The run this entry names is not in the audit log, so there is no key to check it against."
          : "The outcome or approval does not match what the run's key signed: this entry was written or changed by someone else.",
  });

  if (rivalRuns.length > 0) {
    checks.push({
      id: "unique",
      label: "Only one run claims this receipt",
      status: "fail",
      detail:
        `Another run (${rivalRuns.join(", ")}) also logged a validly signed entry for this receipt ID. ` +
        "Receipt IDs are random, so one of them is a copy made with someone else's key; the log cannot say which is genuine.",
    });
  }

  return checks;
}

/** One of possibly several log entries for a receipt ID, with what is needed to check it. */
export interface ResolvedEntry {
  doc: ReceiptDoc;
  run?: RunDoc;
  approver?: ApproverDoc;
  /** Other runs with an authentic entry for the same receipt ID. */
  rivalRuns: string[];
  /** Entries for this ID that failed verification and were set aside. */
  ignored: number;
}

/**
 * Anyone can append to the log, so a receipt ID may have several entries. Picks the one
 * that fully verifies against its own run's key. An entry that does not verify is set
 * aside and cannot hide one that does. When none verifies, the earliest is returned so
 * its failing checks can be shown.
 */
export async function resolveLogEntry(
  entries: ReceiptDoc[],
  lookup: Pick<AuditLookup, "run" | "approver">,
): Promise<ResolvedEntry | undefined> {
  if (entries.length === 0) return undefined;
  const runs = new Map<string, Promise<RunDoc | undefined>>();
  const runOf = (id: string) => {
    if (!runs.has(id)) runs.set(id, lookup.run(id).catch(() => undefined));
    return runs.get(id)!;
  };
  const checked = await Promise.all(
    entries.map(async (doc) => {
      const run = await runOf(doc.runId);
      const keyId = doc.approval?.keyId;
      const approver = keyId && lookup.approver ? await lookup.approver(keyId).catch(() => undefined) : undefined;
      return { doc, run, approver, ok: allPassed(await checkLoggedReceipt(doc, run, approver)) };
    }),
  );
  const authentic = checked.filter((c) => c.ok);
  const chosen = authentic[0] ?? checked[0];
  const rivalRuns = [...new Set(authentic.map((c) => c.doc.runId))].filter((id) => id !== chosen.doc.runId);
  return {
    doc: chosen.doc,
    run: chosen.run,
    approver: chosen.approver,
    rivalRuns,
    ignored: checked.length - authentic.length - (chosen.ok ? 0 : 1),
  };
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
  /** Every log entry for this receipt ID; the authentic one is picked with resolveLogEntry. */
  receipt(id: string): Promise<ReceiptDoc[]>;
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
    const [run, entries] = await Promise.all([lookup.run(doc.runId), lookup.receipt(doc.receipt.id)]);
    loggedRun = run;
    loggedCopy = (await resolveLogEntry(entries, lookup))?.doc;
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
    ? loggedCopy.receipt.digest === doc.receipt.digest &&
      loggedCopy.signature === doc.signature &&
      loggedCopy.runId === doc.runId &&
      loggedCopy.outcome === doc.outcome
      ? { id: "log-copy", label: "Matches the audit log copy", status: "pass", detail: "The audit log holds the same receipt, signature and outcome." }
      : { id: "log-copy", label: "Matches the audit log copy", status: "fail", detail: "The audit log holds a different version of this receipt." }
    : { id: "log-copy", label: "Matches the audit log copy", status: lookupError ? "not-applicable" : "fail", detail: lookupError ? "The audit log could not be read." : "No receipt with this ID is in the audit log." };

  const key = loggedRun?.publicKey ?? fileKey;
  const approver = doc.approval?.keyId && lookup.approver ? await lookup.approver(doc.approval.keyId).catch(() => undefined) : undefined;
  const checks = await checkLoggedReceipt(doc, key ? { agent: "", planner: "live", publicKey: key } : undefined, approver);
  return { kind: "signed", receipt: doc.receipt, checks: [origin, logCopy, ...checks] };
}
