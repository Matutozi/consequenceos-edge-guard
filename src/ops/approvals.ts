import type { DecisionReceipt } from "../domain/types";
import type { ToolMeta } from "./registry";
import { verifyWithPublicKey } from "./signing";
import { approvalMessage, type Approval, type SignedReceipt, type ToolCall } from "./toolGuard";

/**
 * Approvals on Mei Lin's phone. When Edge Guard escalates a call and a paired phone is
 * trusted in this browser, the console writes an approval request to Firestore. The
 * phone answers with a decision signed by a key in Android Keystore. The console only
 * accepts answers signed by a key it was paired with.
 */
export const APPROVERS = "approvers";
export const REQUESTS = "approvalRequests";
export const RESPONSES = "approvalResponses";

/** A phone's registered public key. The document ID is the key's fingerprint. */
export interface ApproverDoc {
  approverId: string;
  name: string;
  role: string;
  platform: string;
  publicKey: JsonWebKey;
}

export interface ApprovalRequestDoc {
  runId: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  registryEntry: ToolMeta & { registered: boolean };
  rationale: string[];
  receipt: DecisionReceipt;
  signature: string;
}

export interface ApprovalResponseDoc {
  receiptId: string;
  decision: "approve" | "reject";
  approverId: string;
  keyId: string;
  /** ISO timestamp, exactly as signed. */
  decidedAt: string;
  signature: string;
  explanation: { text: string; source: "on-device" | "cloud" | "rules" } | null;
}

export const rejectionMessage = (receipt: DecisionReceipt, approverId: string, decidedAt: string) =>
  `edge-guard/rejection:${receipt.id}:${receipt.digest}:${approverId}:${decidedAt}`;

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * A key's fingerprint: the first 16 hex characters of SHA-256 over the raw x and y
 * coordinates. The phone computes the same value and shows it for pairing.
 */
export async function fingerprint(jwk: JsonWebKey): Promise<string> {
  if (!jwk.x || !jwk.y) throw new Error("The key has no coordinates.");
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const bytes = new Uint8Array(x.length + y.length);
  bytes.set(x);
  bytes.set(y, x.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** "ab12cd34ef567890" becomes "AB12 CD34 EF56 7890", as the phone shows it. */
export const formatFingerprint = (id: string) => id.toUpperCase().match(/.{1,4}/g)?.join(" ") ?? id;

/** Checks a phone's answer against the key it was paired with. */
export async function verifyResponse(
  receipt: DecisionReceipt,
  response: ApprovalResponseDoc,
  approver: ApproverDoc,
): Promise<boolean> {
  if (response.receiptId !== receipt.id) return false;
  if (response.approverId !== approver.approverId) return false;
  if ((await fingerprint(approver.publicKey)) !== response.keyId) return false;
  const message =
    response.decision === "approve"
      ? approvalMessage(receipt, response.approverId, response.decidedAt)
      : rejectionMessage(receipt, response.approverId, response.decidedAt);
  return verifyWithPublicKey(approver.publicKey, message, response.signature);
}

/** A phone's approval in the form the executor and the audit log use. */
export const toApproval = (response: ApprovalResponseDoc): Approval => ({
  receiptId: response.receiptId,
  approvedBy: response.approverId,
  approvedAt: response.decidedAt,
  signature: response.signature,
  keyId: response.keyId,
});

export function requestDoc(
  runId: string,
  call: ToolCall,
  meta: ToolMeta & { registered: boolean },
  signed: SignedReceipt,
): ApprovalRequestDoc {
  // JSON round-trip: Firestore rejects undefined, and the receipt must match its digest.
  return JSON.parse(
    JSON.stringify({
      runId,
      agent: call.agent,
      tool: call.tool,
      args: call.args,
      reason: call.reason,
      registryEntry: meta,
      rationale: signed.receipt.decision.rationale,
      receipt: signed.receipt,
      signature: signed.signature,
    }),
  ) as ApprovalRequestDoc;
}

// Paired phones are trusted per browser: the person running the console compares the
// fingerprint on the phone with the one shown here before trusting it.
const TRUST_KEY = "edge-guard-trusted-approvers";

export function trustedApprovers(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TRUST_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{16}$/.test(x)) : [];
  } catch {
    return [];
  }
}

export function setTrusted(keyId: string, trusted: boolean): string[] {
  const next = trusted ? [...new Set([...trustedApprovers(), keyId])] : trustedApprovers().filter((k) => k !== keyId);
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: pairing lasts for this page only.
  }
  return next;
}

async function firestore() {
  const [{ getFirebaseApp }, fs] = await Promise.all([import("../firebase"), import("firebase/firestore")]);
  return { db: fs.getFirestore(getFirebaseApp()), fs };
}

export const approvalStore = {
  async listApprovers(): Promise<(ApproverDoc & { keyId: string; registeredAt?: string })[]> {
    const { db, fs } = await firestore();
    const snap = await fs.getDocs(fs.query(fs.collection(db, APPROVERS), fs.orderBy("registeredAt", "desc"), fs.limit(20)));
    return snap.docs.map((d) => {
      const data = d.data() as ApproverDoc & { registeredAt?: { toDate(): Date } };
      return { ...data, keyId: d.id, registeredAt: data.registeredAt?.toDate().toISOString() };
    });
  },

  async getApprover(keyId: string): Promise<ApproverDoc | undefined> {
    const { db, fs } = await firestore();
    const snap = await fs.getDoc(fs.doc(db, APPROVERS, keyId));
    return snap.exists() ? (snap.data() as ApproverDoc) : undefined;
  },

  /** Offline, Firestore queues the write and never confirms it; give up after 10 s. */
  async request(doc: ApprovalRequestDoc): Promise<void> {
    const { db, fs } = await firestore();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Firestore did not confirm the request within 10 s.")), 10_000);
    });
    try {
      await Promise.race([fs.setDoc(fs.doc(db, REQUESTS, doc.receipt.id), { ...doc, createdAt: fs.serverTimestamp() }), deadline]);
    } finally {
      clearTimeout(timer);
    }
  },

  /** Calls back once with the phone's answer. Returns a function that stops listening. */
  async onResponse(receiptId: string, callback: (response: ApprovalResponseDoc) => void): Promise<() => void> {
    const { db, fs } = await firestore();
    return fs.onSnapshot(
      fs.doc(db, RESPONSES, receiptId),
      (snap) => {
        if (snap.exists()) callback(snap.data() as ApprovalResponseDoc);
      },
      () => {
        // A listener error leaves approval on this screen, which still works.
      },
    );
  },
};
