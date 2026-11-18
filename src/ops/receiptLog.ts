import { canonicalJson } from "../domain/receipt";
import type { Signer } from "./signing";
import type { Approval, SignedReceipt } from "./toolGuard";

/** Firestore collections. The security rules in firestore.rules make both append-only. */
export const RUNS = "runs";
export const RECEIPTS = "receipts";

export type StepOutcome = "executed" | "refused" | "rejected" | "error";

export interface RunDoc {
  agent: string;
  planner: "live" | "recorded";
  /** Public key that signed this run's receipts and approvals. */
  publicKey: JsonWebKey;
}

export interface ReceiptDoc {
  runId: string;
  receipt: SignedReceipt["receipt"];
  signature: string;
  approval: Approval | null;
  outcome: StepOutcome;
  /**
   * The run's signature over the entry: run, receipt, approval and outcome. Without it the
   * outcome and approval are an unsigned claim that anyone could have written. Absent only
   * on entries logged before entries were signed.
   */
  outcomeSignature?: string;
}

/**
 * What the run's key signs when it logs an entry. The receipt is public before it is
 * logged (an approval request carries it), so the outcome and approval must be signed
 * too: otherwise anyone could log the genuine receipt with outcome "rejected".
 */
export const entryMessage = (doc: Pick<ReceiptDoc, "runId" | "receipt" | "approval" | "outcome">) =>
  `edge-guard/log-entry:${canonicalJson({
    runId: doc.runId,
    receiptId: doc.receipt.id,
    digest: doc.receipt.digest,
    approval: doc.approval,
    outcome: doc.outcome,
  })}`;

/** Firestore rejects undefined; JSON round-tripping drops it the same way the digest does. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toReceiptDoc(
  runId: string,
  signed: SignedReceipt,
  approval: Approval | undefined,
  outcome: StepOutcome,
): ReceiptDoc {
  return plain({ runId, receipt: signed.receipt, signature: signed.signature, approval: approval ?? null, outcome });
}

/** The entry as it is logged: signed with the run's key, so its outcome can be verified. */
export async function signedReceiptDoc(
  runId: string,
  signed: SignedReceipt,
  approval: Approval | undefined,
  outcome: StepOutcome,
  signer: Signer,
): Promise<ReceiptDoc> {
  const doc = toReceiptDoc(runId, signed, approval, outcome);
  return { ...doc, outcomeSignature: await signer.sign(entryMessage(doc)) };
}

/** Firestore retries forever when the database is missing or offline; give up visibly instead. */
export const WRITE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms = WRITE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Cloud Firestore did not confirm the write within ${ms / 1000} s.`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function firestore() {
  const [{ getFirebaseApp }, fs] = await Promise.all([import("../firebase"), import("firebase/firestore")]);
  return { db: fs.getFirestore(getFirebaseApp()), fs };
}

/**
 * Append-only audit log in Cloud Firestore. Writes are best effort: if Firestore is
 * unreachable the run continues and the console shows the receipt as not logged.
 *
 * Each entry gets a random document ID, not the receipt's ID. A receipt ID is public
 * before the entry is written, so an ID derived from it could be taken first by someone
 * else, and the genuine entry would then be refused. A receipt may therefore have several
 * entries; verification uses the one signed by the receipt's run (see resolveLogEntry).
 */
export const receiptLog = {
  async startRun(runId: string, run: RunDoc): Promise<void> {
    const { db, fs } = await firestore();
    await withTimeout(fs.setDoc(fs.doc(db, RUNS, runId), { ...plain(run), createdAt: fs.serverTimestamp() }));
  },

  async record(doc: ReceiptDoc): Promise<void> {
    const { db, fs } = await firestore();
    await withTimeout(
      fs.setDoc(fs.doc(fs.collection(db, RECEIPTS)), { ...doc, loggedAt: fs.serverTimestamp() }),
    );
  },

  /**
   * Every entry the log holds for this receipt ID, oldest first. Anyone can append, so
   * the caller must pick the authentic one (resolveLogEntry). Includes an entry stored
   * under the receipt's own ID, as entries were before they were signed.
   */
  async getEntries(id: string): Promise<LoggedReceipt[]> {
    const { db, fs } = await firestore();
    const [legacy, entries] = await Promise.all([
      withTimeout(fs.getDoc(fs.doc(db, RECEIPTS, id))),
      withTimeout(fs.getDocs(fs.query(fs.collection(db, RECEIPTS), fs.where("receipt.id", "==", id), fs.limit(20)))),
    ]);
    const all = entries.docs.map((d) => ({ docId: d.id, data: d.data() }));
    if (legacy.exists() && !all.some((e) => e.docId === legacy.id)) all.push({ docId: legacy.id, data: legacy.data() });
    return all
      .map((e) => fromSnapshot(e.data))
      .sort((a, b) => (a.loggedAt ?? "").localeCompare(b.loggedAt ?? ""));
  },

  async getRun(runId: string): Promise<RunDoc | undefined> {
    const { db, fs } = await firestore();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, RUNS, runId)));
    if (!snap.exists()) return undefined;
    const data = snap.data();
    return { agent: data.agent, planner: data.planner, publicKey: data.publicKey };
  },

  async recent(count = 20): Promise<LoggedReceipt[]> {
    const { db, fs } = await firestore();
    const snap = await withTimeout(
      fs.getDocs(fs.query(fs.collection(db, RECEIPTS), fs.orderBy("loggedAt", "desc"), fs.limit(count))),
    );
    return snap.docs.map((d) => fromSnapshot(d.data()));
  },
};

export interface LoggedReceipt extends ReceiptDoc {
  /** When Firestore recorded it, as an ISO string. */
  loggedAt?: string;
}

function fromSnapshot(data: Record<string, unknown>): LoggedReceipt {
  const { loggedAt, ...rest } = data as unknown as ReceiptDoc & { loggedAt?: { toDate(): Date } | null };
  return { ...(rest as ReceiptDoc), loggedAt: loggedAt?.toDate().toISOString() };
}
