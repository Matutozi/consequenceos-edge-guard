// Writes the receipts the Android approver's tests check, made by the real TypeScript code:
// android/app/src/test/resources/receipt-vectors.json. The phone must compute the same digest
// as src/domain/receipt.ts and accept the same signatures as src/ops/signing.ts, so both test
// suites read this one file (src/ops/receiptVectors.test.ts and ReceiptCheckTest.kt).
// Run: npx vite-node scripts/write-receipt-vectors.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJson, createDecisionReceipt } from "../src/domain/receipt";
import type { DecisionReceipt } from "../src/domain/types";
import { defaultRegistry, lookupTool } from "../src/ops/registry";
import { createSigner } from "../src/ops/signing";
import { guardToolCall, receiptMessage, toProposal } from "../src/ops/toolGuard";

const VECTORS_PATH = fileURLToPath(new URL("../android/app/src/test/resources/receipt-vectors.json", import.meta.url));

/** Values JSON.stringify writes in ways that are easy to get wrong in another language. */
const awkwardValues: unknown[] = [
  { b: 1, a: 2, "10": 3, "9": 4, "01": 5, "": 6, B: 7, é: 8, "4294967295": 9, "4294967294": 10 },
  [0.1, 1e21, 1e-7, 0.000001, 123456789012, 1.5e300, -2.5e-8, 100, 1 / 3, 2 ** 53, -7, 0.5, 5e-324],
  'quote " backslash \\ slash / newline \n tab \t cr \r bell \u0007 nul \u0000 del \u007f',
  "unicode é ü 日本 emoji 🔐 line sep   lone \ud800 high \udc00 low",
  { nested: [{ z: null, y: true, x: false }, [], {}], deep: { "2": [1, "two", { "1": "b", "0": "a" }] } },
];

const outside = { agent: "northwind-ops-agent", tool: "email_user", args: { to: "partner@outside.example", subject: "Your account", body: "Hello" }, reason: "The ticket asks for it." };

async function main() {
  const signer = await createSigner();
  const other = await createSigner();
  const runId = "6f9a1c2e-0000-4000-8000-000000000001";
  const runs = { [runId]: { publicKey: await signer.publicKeyJwk() } };
  const signed = async (receipt: DecisionReceipt, by = signer) => by.sign(receiptMessage(receipt));
  const request = (receipt: DecisionReceipt, signature: string, extra: Record<string, unknown> = {}) => ({
    receiptId: receipt.id,
    runId,
    receipt: JSON.parse(JSON.stringify(receipt)) as DecisionReceipt,
    signature,
    ...extra,
  });

  // 1. A genuine escalation: an email outside Northwind, escalated by the egress rule.
  const genuine = await guardToolCall(outside, { registry: defaultRegistry, signer });

  // 2. An escalation whose arguments hold every awkward value.
  const awkwardCall = { tool: "disable_user", args: { userId: "ada.okafor", awkward: awkwardValues } };
  const awkward = await createDecisionReceipt(
    toProposal({ ...awkwardCall, agent: "northwind-ops-agent", reason: "Reason with \"quotes\" and 🔐" }, lookupTool(defaultRegistry, "disable_user")),
    { assessment: null, inferenceSource: "NONE" },
    { decision: "require_approval", rationale: ["Confidential data.", "Ünïcödé rationale."] },
    awkwardCall,
  );

  // 3. A decoy: the request's unsigned copies say read_ticket, the receipt is for disable_user.
  const disableCall = { agent: "northwind-ops-agent", tool: "disable_user", args: { userId: "mei.lin" }, reason: "Contain the incident." };
  // Confidential data and no Gemini Nano in Node: it fails closed to a person, with no model call.
  const disable = await guardToolCall(disableCall, { registry: defaultRegistry, signer });

  // 4. An allowed call: valid, but there is nothing to approve.
  const read = await guardToolCall({ ...outside, tool: "read_ticket", args: { ticketId: 482 } }, { registry: defaultRegistry, signer });

  const tampered = JSON.parse(JSON.stringify(genuine.receipt)) as DecisionReceipt;
  (tampered.toolCall!.args as Record<string, unknown>).to = "attacker@evil.example";

  const vectors = [
    { name: "genuine escalation", request: request(genuine.receipt, genuine.signature), expect: { verified: true, tool: "email_user" } },
    { name: "awkward values", request: request(awkward, await signed(awkward)), expect: { verified: true, tool: "disable_user" } },
    {
      name: "unsigned copies say something else",
      request: request(disable.receipt, disable.signature, { tool: "read_ticket", args: { ticketId: 1 }, reason: "Just reading." }),
      expect: { verified: true, tool: "disable_user" },
    },
    { name: "arguments changed after signing", request: request(tampered, genuine.signature), expect: { verified: false, why: "changed after" } },
    { name: "signed by another key", request: request(genuine.receipt, await signed(genuine.receipt, other)), expect: { verified: false, why: "not signed by the run" } },
    { name: "not escalated", request: request(read.receipt, read.signature), expect: { verified: false, why: "did not ask for approval" } },
    { name: "receipt for another request", request: { ...request(genuine.receipt, genuine.signature), receiptId: awkward.id }, expect: { verified: false, why: "different call" } },
    { name: "run not in the audit log", request: { ...request(genuine.receipt, genuine.signature), runId: "missing-run" }, expect: { verified: false, why: "not in the audit log" } },
  ];

  const file = {
    note: "Generated by scripts/write-receipt-vectors.ts from the TypeScript receipt and signing code. Do not edit by hand.",
    runs,
    canonical: awkwardValues.map((value) => ({ value, json: canonicalJson(value) })),
    vectors,
  };
  writeFileSync(VECTORS_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${vectors.length} receipts and ${file.canonical.length} canonical JSON cases to ${VECTORS_PATH}`);
}

void main();
