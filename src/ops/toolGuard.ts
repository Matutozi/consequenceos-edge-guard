import type { AnalyzeOptions } from "../ai/analyzeAction";
import { guardAction } from "../domain/guard";
import { evaluateHardRules } from "../domain/policy";
import { DEFAULT_POLICY, type PolicyConfig } from "../domain/policyConfig";
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
  isWildcardTarget,
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

/** A wildcard target means the call acts on everything; never leave that to a model. */
function evaluateFanout(call: ToolCallRecord, meta: ToolMeta, wildcards: string[]): GuardDecision | undefined {
  if (!meta.fanout) return undefined;
  const target = call.args[meta.fanout.arg];
  if (!isWildcardTarget(target, wildcards)) return undefined;
  return {
    decision: "require_approval",
    rationale: [
      `${call.tool} targets everyone (${meta.fanout.arg}: ${JSON.stringify(target)}), so a person has to approve it. ` +
        "Decided by rule, with no model call.",
    ],
  };
}

function isFastPath(meta: ToolMeta, policy: PolicyConfig): boolean {
  const lowSensitivity = meta.sensitivity === "public" || meta.sensitivity === "internal";
  return (
    lowSensitivity &&
    meta.reversible &&
    ((meta.readOnly && policy.fastPathReads) || (meta.lowImpact === true && policy.fastPathLowImpact))
  );
}

function evaluateEgress(call: ToolCallRecord, meta: ToolMeta, domains: string[]): GuardDecision | undefined {
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

/**
 * Everything decided without a model, as a pure function: egress, hard rules, the
 * fanout rule and the fast path. Returns undefined when the call needs the assessor.
 * The Policy page uses it to score a draft without running anything.
 */
export function decideByRules(
  call: ToolCallRecord,
  registry: ToolRegistry,
  internalDomains: string[] = INTERNAL_DOMAINS,
  policy: PolicyConfig = DEFAULT_POLICY,
): GuardDecision | undefined {
  const meta = lookupTool(registry, call.tool);
  const proposal = toProposal({ ...call, agent: "", reason: "" }, meta);
  const ruled =
    evaluateEgress(call, meta, internalDomains) ?? evaluateHardRules(proposal) ?? evaluateFanout(call, meta, policy.wildcardTargets);
  if (ruled) {
    if (!meta.registered) {
      ruled.rationale.unshift(`${call.tool} is not in the tool registry, so it is treated as restricted and irreversible.`);
    }
    return ruled;
  }
  if (isFastPath(meta, policy)) {
    return {
      decision: "allow",
      rationale: [
        meta.readOnly
          ? `${call.tool} only reads ${meta.sensitivity} data. Allowed by rule, with no model call.`
          : `${call.tool} is low impact in the registry, can be undone and touches ${meta.sensitivity} data. ` +
            "Allowed by rule, with no model call.",
      ],
    };
  }
  return undefined;
}

export interface ToolGuardOptions extends AnalyzeOptions {
  registry: ToolRegistry;
  signer: Signer;
  /** Domains inside the organization, for the egress rule. */
  internalDomains?: string[];
  /** The adjustable thresholds. Defaults to DEFAULT_POLICY. */
  policy?: PolicyConfig;
}

/**
 * Edge Guard for agent tool calls. Order of evaluation:
 * 1. Egress rule: data leaving the organization's domains (no model).
 * 2. Hard rules on registry properties (no model; unknown tools are the worst case),
 *    and the fanout rule: a wildcard target goes to a person.
 * 3. Fast path: reads, and low-impact changes that can be undone, on public or
 *    internal data (no model). Model calls are kept for real judgement.
 * 4. Risk assessment (Gemini Nano first) and policy.
 * The resulting receipt is bound to the exact call and signed.
 */
export async function guardToolCall(
  call: ToolCall,
  { registry, signer, internalDomains = INTERNAL_DOMAINS, policy = DEFAULT_POLICY, ...analyzeOptions }: ToolGuardOptions,
): Promise<SignedReceipt> {
  const meta = lookupTool(registry, call.tool);
  const proposal = toProposal(call, meta);
  const record = callRecord(call);

  const ruled = decideByRules(record, registry, internalDomains, policy);
  const receipt: DecisionReceipt = ruled
    ? await createDecisionReceipt(proposal, noModel, ruled, record)
    : await guardAction(proposal, analyzeOptions, record, policy);

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
