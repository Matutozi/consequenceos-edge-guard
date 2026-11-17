import {
  analyzeAction,
  OnDeviceUnavailableError,
  type AnalyzeOptions,
} from "../ai/analyzeAction";
import { escalateUnassessed, evaluateHardRules, evaluatePolicy } from "./policy";
import { createDecisionReceipt } from "./receipt";
import type { ActionProposal, DecisionReceipt, ToolCallRecord } from "./types";

const noModel = { assessment: null, inferenceSource: "NONE" } as const;

/**
 * The full control path: hard rules first (no model needed), then risk analysis and
 * policy. Every outcome produces a receipt; an action that must stay on device but
 * cannot be assessed fails closed to human approval instead of erroring.
 */
export async function guardAction(
  proposal: ActionProposal,
  options: AnalyzeOptions = {},
  toolCall?: ToolCallRecord,
): Promise<DecisionReceipt> {
  const hardDecision = evaluateHardRules(proposal);
  if (hardDecision) return createDecisionReceipt(proposal, noModel, hardDecision, toolCall);

  try {
    const analysis = await analyzeAction(proposal, options);
    return createDecisionReceipt(
      proposal,
      analysis,
      evaluatePolicy(proposal, analysis.assessment),
      toolCall,
    );
  } catch (error) {
    if (error instanceof OnDeviceUnavailableError) {
      return createDecisionReceipt(proposal, noModel, escalateUnassessed(proposal), toolCall);
    }
    throw error;
  }
}
