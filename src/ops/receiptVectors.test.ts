import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, verifyReceipt } from "../domain/receipt";
import type { DecisionReceipt } from "../domain/types";
import { verifyWithPublicKey } from "./signing";
import { receiptMessage } from "./toolGuard";

/**
 * The receipts the Android approver's tests check (ReceiptCheckTest.kt), made by this code
 * with scripts/write-receipt-vectors.ts. These tests hold the file to what the TypeScript
 * side says, so the two languages are compared on the same receipts: if the phone computed a
 * digest differently, it would refuse the genuine ones or accept the tampered ones.
 */
interface Vector {
  name: string;
  request: { receiptId: string; runId: string; receipt: DecisionReceipt; signature: string; tool?: string };
  expect: { verified: true; tool: string } | { verified: false; why: string };
}
const file = JSON.parse(
  readFileSync(new URL("../../android/app/src/test/resources/receipt-vectors.json", import.meta.url), "utf8"),
) as { runs: Record<string, { publicKey: JsonWebKey }>; canonical: { value: unknown; json: string }[]; vectors: Vector[] };

/** What the phone must decide, worked out with the TypeScript receipt and signing code. */
async function approvable({ receiptId, runId, receipt, signature }: Vector["request"]): Promise<boolean> {
  const key = file.runs[runId]?.publicKey;
  return (
    receipt.id === receiptId &&
    (await verifyReceipt(receipt)) &&
    !!key &&
    (await verifyWithPublicKey(key, receiptMessage(receipt), signature)) &&
    receipt.decision.decision === "require_approval"
  );
}

describe("Android receipt vectors", () => {
  it("cover both outcomes", () => {
    const verified = file.vectors.filter((v) => v.expect.verified);
    expect(verified.length).toBeGreaterThanOrEqual(3);
    expect(file.vectors.length - verified.length).toBeGreaterThanOrEqual(4);
  });

  for (const vector of file.vectors) {
    it(`${vector.name}: ${vector.expect.verified ? "approvable" : "refused"}`, async () => {
      expect(await approvable(vector.request)).toBe(vector.expect.verified);
      if (vector.expect.verified) expect(vector.request.receipt.toolCall?.tool).toBe(vector.expect.tool);
    });
  }

  it("include a request whose unsigned copies name a different call from its receipt", () => {
    const decoy = file.vectors.find((v) => v.request.tool && v.request.tool !== v.request.receipt.toolCall?.tool);
    expect(decoy?.expect).toEqual({ verified: true, tool: decoy?.request.receipt.toolCall?.tool });
  });

  it("hold canonical JSON exactly as this code writes it", () => {
    for (const { value, json } of file.canonical) expect(canonicalJson(value)).toBe(json);
    // The JavaScript quirk the phone must copy: integer-like keys come first, in numeric order.
    expect(file.canonical[0].json.startsWith('{"9":4,"10":3,')).toBe(true);
  });
});
