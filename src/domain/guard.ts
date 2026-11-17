import {
  analyzeAction,
  AssessorTimeoutError,
  OnDeviceUnavailableError,
  type AnalyzeOptions,
} from "../ai/analyzeAction";
import { escalateTimedOut, escalateUnassessed, evaluateHardRules, evaluatePolicy } from "./policy";
import { DEFAULT_POLICY, type PolicyConfig } from "./policyConfig";
import { createDecisionReceipt } from "./receipt";
import type { ActionProposal, DecisionReceipt, ToolCallRecord } from "./types";

const noModel = { assessment: null, inferenceSource: "NONE" } as const;

/**
 * The full control path: hard rules first (no model needed), then risk analysis and
 * policy. Every outcome produces a receipt. An action that must stay on device but
 * cannot be assessed, or whose assessment times out, fails closed to human approval.
 */
export async function guardAction(
  proposal: ActionProposal,
  options: AnalyzeOptions = {},
  toolCall?: ToolCallRecord,
  policy: PolicyConfig = DEFAULT_POLICY,
): Promise<DecisionReceipt> {
  const hardDecision = evaluateHardRules(proposal);
  if (hardDecision) return createDecisionReceipt(proposal, noModel, hardDecision, toolCall);

  try {
    const analysis = await analyzeAction(proposal, {
      timeoutMs: policy.assessorTimeoutSeconds * 1000,
      ...options,
    });
    return createDecisionReceipt(
      proposal,
      analysis,
      evaluatePolicy(proposal, analysis.assessment, policy),
      toolCall,
    );
  } catch (error) {
    if (error instanceof OnDeviceUnavailableError) {
      return createDecisionReceipt(proposal, noModel, escalateUnassessed(proposal), toolCall);
    }
    if (error instanceof AssessorTimeoutError) {
      return createDecisionReceipt(
        proposal,
        { assessment: null, inferenceSource: "TIMED_OUT" },
        escalateTimedOut(error.ms),
        toolCall,
      );
    }
    throw error;
  }
}
