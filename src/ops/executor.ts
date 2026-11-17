import { canonicalJson, verifyReceipt } from "../domain/receipt";
import type { ToolCallRecord } from "../domain/types";
import { approvalMessage, receiptMessage, type Approval, type SignedReceipt } from "./toolGuard";

export class ExecutionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionRefused";
  }
}

export type ToolImpl<S> = (state: S, args: Record<string, unknown>) => { state: S; output: string };

/**
 * Runs tools only with a valid Edge Guard receipt for that exact call.
 * No receipt, no action.
 */
export class Executor<S> {
  private readonly usedReceipts = new Set<string>();

  constructor(
    private readonly verifySignature: (message: string, signature: string) => Promise<boolean>,
    private readonly tools: Record<string, ToolImpl<S>>,
  ) {}

  /** Throws ExecutionRefused unless the call is authorized. Never runs a tool on refusal. */
  async authorize(call: ToolCallRecord, signed?: SignedReceipt, approval?: Approval): Promise<void> {
    if (!signed) throw new ExecutionRefused("No receipt, no action.");
    const { receipt, signature } = signed;

    if (!(await verifyReceipt(receipt))) {
      throw new ExecutionRefused("The receipt's digest does not match its contents.");
    }
    if (!(await this.verifySignature(receiptMessage(receipt), signature))) {
      throw new ExecutionRefused("The receipt is not signed by Edge Guard.");
    }
    if (!receipt.toolCall || canonicalJson(receipt.toolCall) !== canonicalJson(call)) {
      throw new ExecutionRefused("The receipt authorizes a different call.");
    }
    if (this.usedReceipts.has(receipt.id)) {
      throw new ExecutionRefused("The receipt has already been used.");
    }

    switch (receipt.decision.decision) {
      case "deny":
        throw new ExecutionRefused("Edge Guard denied this action.");
      case "require_approval": {
        const approved =
          approval?.receiptId === receipt.id &&
          (await this.verifySignature(
            approvalMessage(receipt, approval.approvedBy, approval.approvedAt),
            approval.signature,
          ));
        if (!approved) throw new ExecutionRefused("This action needs a valid human approval.");
        break;
      }
      case "allow":
        break;
    }

    if (!Object.hasOwn(this.tools, call.tool)) {
      throw new ExecutionRefused(`No tool named "${call.tool}" is installed.`);
    }
  }

  async execute(
    state: S,
    call: ToolCallRecord,
    signed?: SignedReceipt,
    approval?: Approval,
  ): Promise<{ state: S; output: string }> {
    await this.authorize(call, signed, approval);
    // Single use: consumed before running, so a failing tool cannot be retried on the same receipt.
    this.usedReceipts.add(signed!.receipt.id);
    return this.tools[call.tool](state, call.args);
  }
}
