import type { AnalyzeOptions } from "../ai/analyzeAction";
import { guardAction } from "../domain/guard";
import { evaluateHardRules } from "../domain/policy";
import { canonicalJson, createDecisionReceipt } from "../domain/receipt";
import type {
  ActionProposal,
  DecisionReceipt,
  GuardDecision,
  ToolCallRecord,
} from "../domain/types";
import {
  INTERNAL_DOMAINS,
  isInternalDestination,
  lookupTool,
  type ToolMeta,
  type ToolRegistry,
} from "./registry";
import type { Signer } from "./signing";

/** What an agent submits. It never declares sensitivity or reversibility. */
export interface ToolCall extends ToolCallRecord {
  agent: string;
  reason: string;
}

export interface SignedReceipt {
  receipt: DecisionReceipt;
  signature: string;
}

export interface Approval {
  receiptId: string;
  approvedBy: string;
  approvedAt: string;
  signature: string;
}

export const receiptMessage = (receipt: DecisionReceipt) => `edge-guard/receipt:${receipt.digest}`;

export const approvalMessage = (receipt: DecisionReceipt, approvedBy: string, approvedAt: string) =>
  `edge-guard/approval:${receipt.id}:${receipt.digest}:${approvedBy}:${approvedAt}`;

/** The call as the receipt records it: tool and arguments only. */
export function callRecord(call: ToolCallRecord): ToolCallRecord {
  return { tool: call.tool, args: call.args };
}

export function toProposal(call: ToolCall, meta: ToolMeta & { registered: boolean }): ActionProposal {
  return {
    actor: call.agent,
    action: `${call.tool}(${canonicalJson(call.args)}). ${meta.description}`,
    target: meta.registered ? meta.system : `${meta.system} (tool "${call.tool}" is not registered)`,
    context: call.reason,
    dataSensitivity: meta.sensitivity,
    reversible: meta.reversible,
  };
}

const noModel = { assessment: null, inferenceSource: "NONE" } as const;

function evaluateEgress(call: ToolCall, meta: ToolMeta, domains: string[]): GuardDecision | undefined {
  if (!meta.egress) return undefined;
  const destination = call.args[meta.egress.arg];
  if (isInternalDestination(destination, domains)) return undefined;
  return meta.egress.outside === "deny"
    ? { decision: "deny", rationale: [`Sends data to ${String(destination)}, which is outside ${domains.join(", ")}. Blocked by rule.`] }
    : {
        decision: "require_approval",
        rationale: [`Sends to ${String(destination)}, which is outside ${domains.join(", ")}, so a person has to approve it.`],
      };
}

export interface ToolGuardOptions extends AnalyzeOptions {
  registry: ToolRegistry;
  signer: Signer;
  /** Domains inside the organization, for the egress rule. */
  internalDomains?: string[];
}

/**
 * Edge Guard for agent tool calls. Order of evaluation:
 * 1. Egress rule: data leaving the organization's domains (no model).
 * 2. Hard rules on registry properties (no model; unknown tools are the worst case).
 * 3. Fast path: read-only access to public or internal data (no model).
 * 4. Risk assessment (Gemini Nano first) and policy.
 * The resulting receipt is bound to the exact call and signed.
 */
export async function guardToolCall(
  call: ToolCall,
  { registry, signer, internalDomains = INTERNAL_DOMAINS, ...analyzeOptions }: ToolGuardOptions,
): Promise<SignedReceipt> {
  const meta = lookupTool(registry, call.tool);
  const proposal = toProposal(call, meta);
  const record = callRecord(call);

  let receipt: DecisionReceipt;
  const egressDecision = evaluateEgress(call, meta, internalDomains);
  const hardDecision = egressDecision ?? evaluateHardRules(proposal);
  if (hardDecision) {
    if (!meta.registered) {
      hardDecision.rationale.unshift(
        `${call.tool} is not in the tool registry, so it is treated as restricted and irreversible.`,
      );
    }
    receipt = await createDecisionReceipt(proposal, noModel, hardDecision, record);
  } else if (meta.readOnly && ["public", "internal"].includes(meta.sensitivity)) {
    receipt = await createDecisionReceipt(
      proposal,
      noModel,
      {
        decision: "allow",
        rationale: [
          `${call.tool} only reads ${meta.sensitivity} data. Allowed by rule, with no model call.`,
        ],
      },
      record,
    );
  } else {
    receipt = await guardAction(proposal, analyzeOptions, record);
  }

  return { receipt, signature: await signer.sign(receiptMessage(receipt)) };
}

/** Records a human's approval of an escalated receipt, signed by the guard. */
export async function approveReceipt(
  { receipt }: SignedReceipt,
  approvedBy: string,
  signer: Signer,
): Promise<Approval> {
  const approvedAt = new Date().toISOString();
  return {
    receiptId: receipt.id,
    approvedBy,
    approvedAt,
    signature: await signer.sign(approvalMessage(receipt, approvedBy, approvedAt)),
  };
}
