import type {
  ActionProposal,
  DecisionReceipt,
  GuardDecision,
  ReceiptAnalysis,
} from "./types";

export const RECEIPT_DIGEST_ALGORITHM = "sha256-canonical-json-v1";

type ReceiptBody = Omit<DecisionReceipt, "digest">;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** JSON with object keys sorted recursively, so the digest is independent of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

async function digestBody(body: ReceiptBody): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(body))),
  );
}

export async function createDecisionReceipt(
  proposal: ActionProposal,
  analysis: ReceiptAnalysis,
  decision: GuardDecision,
): Promise<DecisionReceipt> {
  const body: ReceiptBody = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    digestAlgorithm: RECEIPT_DIGEST_ALGORITHM,
    proposal,
    assessment: analysis.assessment,
    decision,
    inferenceSource: analysis.inferenceSource,
  };

  return { ...body, digest: await digestBody(body) };
}

/**
 * Recomputes the digest over every field except `digest`. This detects accidental or
 * casual modification only: without a signature, anyone can edit a receipt and
 * recompute a matching digest.
 */
export async function verifyReceipt(receipt: DecisionReceipt): Promise<boolean> {
  const { digest, ...body } = receipt;
  if (body.digestAlgorithm !== RECEIPT_DIGEST_ALGORITHM) return false;
  return (await digestBody(body)) === digest;
}
