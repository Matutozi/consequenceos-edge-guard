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
}

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
 */
export const receiptLog = {
  async startRun(runId: string, run: RunDoc): Promise<void> {
    const { db, fs } = await firestore();
    await withTimeout(fs.setDoc(fs.doc(db, RUNS, runId), { ...plain(run), createdAt: fs.serverTimestamp() }));
  },

  async record(doc: ReceiptDoc): Promise<void> {
    const { db, fs } = await firestore();
    await withTimeout(
      fs.setDoc(fs.doc(db, RECEIPTS, doc.receipt.id), { ...doc, loggedAt: fs.serverTimestamp() }),
    );
  },
};
