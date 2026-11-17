import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const analyzeAction = vi.hoisted(() => vi.fn());

vi.mock("../ai/analyzeAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/analyzeAction")>()),
  analyzeAction,
}));

const { defaultRegistry } = await import("./registry");
const { createSigner } = await import("./signing");
const { approveReceipt, callRecord, guardToolCall } = await import("./toolGuard");
const { ExecutionRefused, Executor } = await import("./executor");
const { initialNorthwindState, northwindTools, OPS_AGENT } = await import("./northwind");

type Signer = Awaited<ReturnType<typeof createSigner>>;
type ToolCall = Parameters<typeof guardToolCall>[0];

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});

beforeEach(() => {
  analyzeAction.mockReset();
  analyzeAction.mockResolvedValue({
    assessment: {
      riskLevel: "low",
      summary: "Routine",
      reasons: [],
      sensitiveData: [],
      blastRadius: "single_user",
      recommendedControl: "allow",
    },
    inferenceSource: "ON_DEVICE",
  });
});

const call = (tool: string, args: Record<string, unknown> = {}): ToolCall => ({
  agent: OPS_AGENT,
  tool,
  args,
  reason: "test",
});

const guard = (c: ToolCall) => guardToolCall(c, { registry: defaultRegistry, signer });
const executor = () => new Executor(signer.verify, northwindTools);

describe("guardToolCall", () => {
  it("allows read-only internal tools without a model call", async () => {
    const { receipt } = await guard(call("read_ticket", { ticketId: 482 }));
    expect(receipt.decision.decision).toBe("allow");
    expect(receipt.inferenceSource).toBe("NONE");
    expect(analyzeAction).not.toHaveBeenCalled();
  });

  it("denies restricted irreversible tools by hard rule without a model call", async () => {
    const { receipt } = await guard(call("delete_audit_logs", { scope: "all" }));
    expect(receipt.decision.decision).toBe("deny");
    expect(analyzeAction).not.toHaveBeenCalled();
  });

  it("treats an unregistered tool as the worst case", async () => {
    const { receipt } = await guard(call("run_shell", { cmd: "rm -rf /" }));
    expect(receipt.decision.decision).toBe("deny");
    expect(receipt.decision.rationale[0]).toMatch(/not in the tool registry/);
    expect(receipt.proposal.dataSensitivity).toBe("restricted");
  });

  it("takes sensitivity from the registry, not the agent", async () => {
    const { receipt } = await guard(call("disable_user", { userId: "ada.okafor" }));
    expect(receipt.proposal.dataSensitivity).toBe("confidential");
    expect(receipt.decision.decision).toBe("require_approval");
  });

  it("binds the receipt to the exact call", async () => {
    const { receipt } = await guard(call("revoke_sessions", { userId: "ada.okafor" }));
    expect(receipt.toolCall).toEqual({ tool: "revoke_sessions", args: { userId: "ada.okafor" } });
  });
});

describe("Executor", () => {
  const state = initialNorthwindState();

  it("runs an allowed call", async () => {
    const c = call("revoke_sessions", { userId: "ada.okafor" });
    const result = await executor().execute(state, callRecord(c), await guard(c));
    expect(result.state.users.find((u) => u.id === "ada.okafor")?.sessions).toBe(0);
  });

  it("refuses without a receipt", async () => {
    await expect(
      executor().execute(state, callRecord(call("revoke_sessions", { userId: "ada.okafor" }))),
    ).rejects.toThrow(/No receipt, no action/);
  });

  it("refuses a receipt for different arguments", async () => {
    const signed = await guard(call("revoke_sessions", { userId: "ada.okafor" }));
    await expect(
      executor().execute(state, callRecord(call("revoke_sessions", { userId: "mei.lin" })), signed),
    ).rejects.toThrow(/different call/);
  });

  it("refuses a tampered receipt even with a recomputed digest", async () => {
    const signed = await guard(call("delete_audit_logs", { scope: "all" }));
    const forged = await guard(call("read_ticket", { ticketId: 482 }));
    // Swap in an allow decision from another receipt: digest no longer matches.
    const tampered = { ...signed, receipt: { ...signed.receipt, decision: forged.receipt.decision } };
    await expect(
      executor().execute(state, callRecord(call("delete_audit_logs", { scope: "all" })), tampered),
    ).rejects.toBeInstanceOf(ExecutionRefused);
  });

  it("refuses a receipt signed by another key", async () => {
    const other = await createSigner();
    const c = call("revoke_sessions", { userId: "ada.okafor" });
    const signed = await guardToolCall(c, { registry: defaultRegistry, signer: other });
    await expect(executor().execute(state, callRecord(c), signed)).rejects.toThrow(/not signed by Edge Guard/);
  });

  it("refuses a denied call", async () => {
    const c = call("export_customers", { destination: "recovery@northwind-backup.co" });
    await expect(executor().execute(state, callRecord(c), await guard(c))).rejects.toThrow(/denied/);
  });

  it("refuses an escalated call until a human approves it", async () => {
    const c = call("disable_user", { userId: "ada.okafor" });
    const signed = await guard(c);
    const ex = executor();
    await expect(ex.execute(state, callRecord(c), signed)).rejects.toThrow(/human approval/);
    const approval = await approveReceipt(signed, "mei.lin", signer);
    const result = await ex.execute(state, callRecord(c), signed, approval);
    expect(result.state.users.find((u) => u.id === "ada.okafor")?.status).toBe("disabled");
  });

  it("refuses an approval for another receipt", async () => {
    const c = call("disable_user", { userId: "ada.okafor" });
    const signed = await guard(c);
    const otherApproval = await approveReceipt(await guard(c), "mei.lin", signer);
    await expect(executor().execute(state, callRecord(c), signed, otherApproval)).rejects.toThrow(
      /human approval/,
    );
  });

  it("refuses to reuse a receipt", async () => {
    const c = call("revoke_sessions", { userId: "ada.okafor" });
    const signed = await guard(c);
    const ex = executor();
    await ex.execute(state, callRecord(c), signed);
    await expect(ex.execute(state, callRecord(c), signed)).rejects.toThrow(/already been used/);
  });
});
