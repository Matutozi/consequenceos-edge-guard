import { describe, expect, it } from "vitest";
import { createDecisionReceipt } from "../domain/receipt";
import type { PolicyDecision } from "../domain/types";
import { MAX_ENTRIES_READ, readAllPages, signedReceiptDoc, toReceiptDoc, type ReceiptDoc, type RunDoc, type StepOutcome } from "./receiptLog";
import { createSigner } from "./signing";
import { approveReceipt, receiptMessage } from "./toolGuard";
import { allPassed, checkLoggedReceipt, checkPastedReceipt, resolveLogEntry } from "./verifyLogged";

async function logged(decision: PolicyDecision, outcome: StepOutcome, approve = false, runId = "run") {
  const signer = await createSigner();
  const receipt = await createDecisionReceipt(
    { actor: "a", action: "x", target: "t", context: "c", dataSensitivity: "internal", reversible: true },
    { assessment: null, inferenceSource: "NONE" },
    { decision, rationale: ["r"] },
    { tool: "disable_user", args: { userId: "ada.okafor" } },
  );
  const signed = { receipt, signature: await signer.sign(receiptMessage(receipt)) };
  const approval = approve ? await approveReceipt(signed, "mei.lin", signer) : undefined;
  const run: RunDoc = { agent: "a", planner: "recorded", publicKey: await signer.publicKeyJwk() };
  // Round-trip like a Firestore read.
  const doc = JSON.parse(JSON.stringify(await signedReceiptDoc(runId, signed, approval, outcome, signer)));
  return { doc, run, signer, signed };
}

const status = (checks: Awaited<ReturnType<typeof checkLoggedReceipt>>, id: string) =>
  checks.find((c) => c.id === id)?.status;

describe("checkLoggedReceipt", () => {
  it("passes an allowed, executed receipt", async () => {
    const { doc, run } = await logged("allow", "executed");
    const checks = await checkLoggedReceipt(doc, run);
    expect(allPassed(checks)).toBe(true);
    expect(status(checks, "approval")).toBe("not-applicable");
  });

  it("passes an escalated receipt with a valid approval", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    const checks = await checkLoggedReceipt(doc, run);
    expect(allPassed(checks)).toBe(true);
    expect(status(checks, "approval")).toBe("pass");
  });

  it("detects a decision changed after logging", async () => {
    const { doc, run } = await logged("deny", "refused");
    doc.receipt.decision.decision = "allow";
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "digest")).toBe("fail");
    // The signature is valid for the original digest but must not vouch for changed contents.
    expect(status(checks, "signature")).toBe("fail");
    expect(allPassed(checks)).toBe(false);
  });

  it("shows no passing check at all on a tampered receipt", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    doc.receipt.decision.decision = "allow";
    const checks = await checkLoggedReceipt(doc, run);
    expect(checks.filter((c) => c.status === "pass").map((c) => c.id)).toEqual([]);
    expect(status(checks, "binding")).toBe("not-applicable");
    expect(status(checks, "outcome")).toBe("not-applicable");
  });

  it("does not count an approval for a receipt whose contents changed", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    doc.receipt.toolCall.args.userId = "everyone";
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "approval")).toBe("fail");
    expect(status(checks, "outcome")).toBe("not-applicable");
  });

  it("detects a digest recomputed by a forger, through the signature", async () => {
    const { doc, run } = await logged("deny", "refused");
    const forged = await createDecisionReceipt(doc.receipt.proposal, doc.receipt, { decision: "allow", rationale: [] }, doc.receipt.toolCall);
    const checks = await checkLoggedReceipt({ ...doc, receipt: { ...forged, id: doc.receipt.id } }, run);
    expect(status(checks, "signature")).toBe("fail");
  });

  it("fails a receipt checked against another run's key", async () => {
    const { doc } = await logged("allow", "executed");
    const { run: otherRun } = await logged("allow", "executed");
    expect(status(await checkLoggedReceipt(doc, otherRun), "signature")).toBe("fail");
  });

  it("fails when the run is missing", async () => {
    const { doc } = await logged("allow", "executed");
    expect(status(await checkLoggedReceipt(doc, undefined), "signature")).toBe("fail");
  });

  it("flags a denied call that executed", async () => {
    const { doc, run } = await logged("deny", "executed");
    expect(status(await checkLoggedReceipt(doc, run), "outcome")).toBe("fail");
  });

  it("flags an escalated call that executed without approval", async () => {
    const { doc, run } = await logged("require_approval", "executed");
    const checks = await checkLoggedReceipt(doc, run);
    expect(status(checks, "outcome")).toBe("fail");
  });

  it("fails an approval whose signature does not verify", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    doc.approval.approvedBy = "someone.else";
    expect(status(await checkLoggedReceipt(doc, run), "approval")).toBe("fail");
  });
});

describe("signed log entries", () => {
  it("fails the genuine receipt logged by someone else with a false outcome", async () => {
    // The attack: the receipt is public in the approval request before it is logged, so
    // anyone can log it as "rejected" with no approval, although it was approved and ran.
    const { doc, run } = await logged("require_approval", "executed", true);
    const squat: ReceiptDoc = { ...doc, approval: null, outcome: "rejected", outcomeSignature: undefined };
    const checks = await checkLoggedReceipt(squat, run);
    expect(status(checks, "outcome")).toBe("pass");
    expect(status(checks, "entry")).toBe("fail");
    expect(allPassed(checks)).toBe(false);
    // Reusing the genuine entry's signature does not help: it covers the real outcome.
    expect(status(await checkLoggedReceipt({ ...squat, outcomeSignature: doc.outcomeSignature }, run), "entry")).toBe("fail");
  });

  it("fails an entry whose outcome or approval changed after logging", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    expect(status(await checkLoggedReceipt({ ...doc, outcome: "error" }, run), "entry")).toBe("fail");
    expect(status(await checkLoggedReceipt({ ...doc, approval: null }, run), "entry")).toBe("fail");
    expect(status(await checkLoggedReceipt({ ...doc, runId: "other" }, run), "entry")).toBe("fail");
  });

  it("does not pass an unsigned entry from before entries were signed", async () => {
    const { signed, run } = await logged("allow", "executed");
    const legacy = JSON.parse(JSON.stringify(toReceiptDoc("run", signed, undefined, "executed")));
    expect(status(await checkLoggedReceipt(legacy, run), "entry")).toBe("fail");
  });

  it("picks the signed entry, whatever was logged before it", async () => {
    const { doc, run } = await logged("require_approval", "executed", true);
    const squat: ReceiptDoc = { ...doc, approval: null, outcome: "rejected", outcomeSignature: undefined };
    const resolved = await resolveLogEntry([squat, doc], { run: async () => run });
    expect(resolved?.doc.outcome).toBe("executed");
    expect(resolved?.ignored).toBe(1);
    expect(resolved?.rivalRuns).toEqual([]);
    expect(allPassed(await checkLoggedReceipt(resolved!.doc, resolved!.run, undefined, resolved!.rivalRuns))).toBe(true);
  });

  it("shows a conflict, never a pass, when another run re-signs a copy of the receipt", async () => {
    const { doc, run, signed } = await logged("require_approval", "executed", true, "genuine");
    const attacker = await createSigner();
    const copied = { receipt: signed.receipt, signature: await attacker.sign(receiptMessage(signed.receipt)) };
    const copy = JSON.parse(JSON.stringify(await signedReceiptDoc("forged", copied, undefined, "rejected", attacker)));
    const runs: Record<string, RunDoc> = { genuine: run, forged: { ...run, publicKey: await attacker.publicKeyJwk() } };
    const resolved = await resolveLogEntry([copy, doc], { run: async (id) => runs[id] });
    expect(resolved?.rivalRuns).toHaveLength(1);
    const checks = await checkLoggedReceipt(resolved!.doc, resolved!.run, undefined, resolved!.rivalRuns);
    expect(status(checks, "unique")).toBe("fail");
    expect(allPassed(checks)).toBe(false);
  });

  it("returns the earliest entry when none verifies, so its failures can be shown", async () => {
    const { doc, run } = await logged("allow", "executed");
    const resolved = await resolveLogEntry([{ ...doc, outcomeSignature: undefined }], { run: async () => run });
    expect(resolved?.ignored).toBe(0);
    expect(await resolveLogEntry([], { run: async () => run })).toBeUndefined();
  });
});

describe("reading every entry for a receipt ID", () => {
  /**
   * The log as Firestore pages it: by document ID. Anyone can append entries for a known
   * receipt ID under IDs they choose, so junk can sort before the genuine entry.
   */
  function collection(docs: { id: string; doc: ReceiptDoc }[]) {
    const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
    let reads = 0;
    const fetchPage = async (after: string | undefined, pageSize = 100) => {
      reads++;
      const start = after === undefined ? 0 : sorted.findIndex((d) => d.id === after) + 1;
      const page = sorted.slice(start, start + pageSize);
      return { items: page, cursor: page.at(-1)?.id };
    };
    return { fetchPage, reads: () => reads };
  }

  async function flooded(junkCount: number) {
    const { doc, run } = await logged("require_approval", "executed", true);
    const junk: ReceiptDoc = { ...doc, approval: null, outcome: "rejected", outcomeSignature: undefined };
    const docs = [
      ...Array.from({ length: junkCount }, (_, i) => ({ id: `0000${String(i).padStart(16, "0")}`, doc: junk })),
      { id: "Zq9GenuineRandomId01", doc },
    ];
    return { doc, run, ...collection(docs) };
  }

  it("finds the genuine entry behind junk that sorts first, which the old 20-entry read missed", async () => {
    const { doc, run, fetchPage } = await flooded(150);
    expect((await fetchPage(undefined, 20)).items.some((d) => d.doc === doc)).toBe(false); // the old read
    const { items, complete } = await readAllPages(fetchPage);
    expect(complete).toBe(true);
    expect(items).toHaveLength(151);
    const resolved = await resolveLogEntry({ entries: items.map((d) => d.doc), complete }, { run: async () => run });
    expect(resolved?.doc.outcome).toBe("executed");
    expect(resolved?.ignored).toBe(150);
    expect(allPassed(await checkLoggedReceipt(resolved!.doc, resolved!.run, undefined, resolved!.rivalRuns, resolved!.complete))).toBe(true);
  });

  it("stops at a full page boundary only when the next page is empty", async () => {
    const { fetchPage, reads } = await flooded(199);
    const { items, complete } = await readAllPages(fetchPage);
    expect([items.length, complete, reads()]).toEqual([200, true, 3]);
  });

  it("says the log is incomplete, and fails verification, when it is flooded past what Verify reads", async () => {
    const { fetchPage } = await flooded(MAX_ENTRIES_READ + 200);
    const { items, complete } = await readAllPages(fetchPage);
    expect(items).toHaveLength(MAX_ENTRIES_READ);
    expect(complete).toBe(false);
    // Even when the genuine entry is among those read, a rival could be among the rest.
    const genuine = await logged("allow", "executed");
    const lookup = { run: async () => genuine.run };
    const whole = await resolveLogEntry({ entries: [genuine.doc], complete: true }, lookup);
    expect(allPassed(await checkLoggedReceipt(whole!.doc, genuine.run, undefined, whole!.rivalRuns, whole!.complete))).toBe(true);
    const resolved = await resolveLogEntry({ entries: [genuine.doc], complete }, lookup);
    const checks = await checkLoggedReceipt(resolved!.doc, genuine.run, undefined, resolved!.rivalRuns, resolved!.complete);
    expect(checks.filter((c) => c.status === "fail").map((c) => c.id)).toEqual(["complete"]);
    expect(checks.find((c) => c.id === "complete")?.detail).toMatch(/flooding the log/);
    expect(allPassed(checks)).toBe(false);
  });

  it("fails a pasted receipt the same way when its log entries are flooded", async () => {
    const { doc, run } = await logged("deny", "refused");
    const text = JSON.stringify({ ...doc, publicKey: run.publicKey });
    const ok = await checkPastedReceipt(text, { run: async () => run, receipt: async () => ({ entries: [doc], complete: true }) });
    expect(allPassed(ok.checks)).toBe(true);
    const floodedResult = await checkPastedReceipt(text, { run: async () => run, receipt: async () => ({ entries: [doc], complete: false }) });
    expect(floodedResult.checks.find((c) => c.id === "complete")?.status).toBe("fail");
    expect(allPassed(floodedResult.checks)).toBe(false);
  });
});

describe("checkPastedReceipt", () => {
  async function signedFile() {
    const { doc, run } = await logged("deny", "refused");
    return { doc, run, text: JSON.stringify({ ...doc, publicKey: run.publicKey }) };
  }

  it("verifies a downloaded receipt against the key in the audit log", async () => {
    const { doc, run, text } = await signedFile();
    const result = await checkPastedReceipt(text, { run: async () => run, receipt: async () => [doc] });
    expect(result.kind).toBe("signed");
    expect(allPassed(result.checks)).toBe(true);
  });

  it("does not trust a key that only exists inside the file", async () => {
    const { text } = await signedFile();
    const result = await checkPastedReceipt(text, { run: async () => undefined, receipt: async () => [] });
    expect(result.checks.find((c) => c.id === "origin")?.status).toBe("fail");
    expect(allPassed(result.checks)).toBe(false);
  });

  it("catches a forged receipt signed with the forger's own key", async () => {
    const { doc, run } = await signedFile();
    const { doc: forged, run: forgerRun } = await logged("allow", "executed");
    const text = JSON.stringify({ ...forged, runId: doc.runId, receipt: { ...forged.receipt, id: doc.receipt.id }, publicKey: forgerRun.publicKey });
    const result = await checkPastedReceipt(text, { run: async () => run, receipt: async () => [doc] });
    expect(result.checks.find((c) => c.id === "origin")?.status).toBe("fail");
    expect(result.checks.find((c) => c.id === "signature")?.status).toBe("fail");
    expect(result.checks.find((c) => c.id === "log-copy")?.status).toBe("fail");
  });

  it("reports an unreachable audit log without pretending to verify", async () => {
    const { text } = await signedFile();
    const offline = async () => { throw new Error("offline"); };
    const result = await checkPastedReceipt(text, { run: offline, receipt: offline });
    expect(result.checks.find((c) => c.id === "origin")?.detail).toMatch(/could not be read \(offline\)/);
    expect(allPassed(result.checks)).toBe(false);
  });

  it("checks a single-action receipt by digest and says it is not signed", async () => {
    const { doc } = await logged("allow", "executed");
    const ok = await checkPastedReceipt(JSON.stringify(doc.receipt), { run: async () => undefined, receipt: async () => [] });
    expect(ok.kind).toBe("digest-only");
    expect(allPassed(ok.checks)).toBe(true);
    const tampered = await checkPastedReceipt(JSON.stringify({ ...doc.receipt, decision: { decision: "deny", rationale: [] } }), { run: async () => undefined, receipt: async () => [] });
    expect(allPassed(tampered.checks)).toBe(false);
  });

  it("rejects text that is not a receipt", async () => {
    const lookup = { run: async () => undefined, receipt: async () => [] };
    await expect(checkPastedReceipt("{nope", lookup)).rejects.toThrow(/not valid JSON/);
    await expect(checkPastedReceipt('{"hello":1}', lookup)).rejects.toThrow(/doesn't look like/);
  });
});
