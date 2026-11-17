import {
  analyzeAction,
  AssessorTimeoutError,
  isSensitive,
  OnDeviceUnavailableError,
  type AnalyzeOptions,
} from "../ai/analyzeAction";
import { escalateTimedOut, escalateUnassessed, escalateUnavailable, evaluateHardRules, evaluatePolicy } from "./policy";
import { DEFAULT_POLICY, type PolicyConfig } from "./policyConfig";
import { createDecisionReceipt } from "./receipt";
import type {
  ActionProposal,
  AnalysisResult,
  DecisionReceipt,
  GuardDecision,
  PolicyDecision,
  ReceiptAnalysis,
  ToolCallRecord,
} from "./types";

const strictness: Record<PolicyDecision, number> = { allow: 0, require_approval: 1, deny: 2 };

/** A short, plain reason for a failed model call, for the signed receipt and the inspector. */
export function plainFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|network|offline|ERR_INTERNET|ENOTFOUND|ECONNREFUSED/i.test(message)) return "no network connection";
  if (/\b429\b|quota|rate limit/i.test(message)) return "the cloud model's rate limit was reached (429)";
  if (/\b40[13]\b|app check/i.test(message)) return "the request was refused by App Check";
  if (/timed? ?out|deadline/i.test(message)) return "it did not answer in time";
  return "the model returned an error";
}
const decisionWords: Record<PolicyDecision, string> = {
  allow: "allows it",
  require_approval: "says a person should approve it",
  deny: "says to block it",
};

/**
 * Gemini Nano would allow the call. An allow needs a second opinion from the cloud, and
 * the stricter answer wins. Data that may not leave the device, or a cloud that does
 * not answer, sends the call to a person instead: the device never allows alone.
 */
async function withSecondOpinion(
  proposal: ActionProposal,
  device: AnalysisResult,
  first: GuardDecision,
  options: AnalyzeOptions,
  policy: PolicyConfig,
): Promise<{ analysis: ReceiptAnalysis; decision: GuardDecision }> {
  if (isSensitive(proposal)) {
    return {
      analysis: { ...device, secondOpinion: { status: "not-sent" } },
      decision: {
        decision: "require_approval",
        rationale: [
          `Gemini Nano would allow it, but ${proposal.dataSensitivity} data cannot go to the cloud for a second opinion, so a person decides.`,
        ],
      },
    };
  }
  try {
    const cloud = await analyzeAction(proposal, { ...options, route: "cloud", timeoutMs: policy.assessorTimeoutSeconds * 1000 });
    const second = evaluatePolicy(proposal, cloud.assessment, policy);
    const stricter = strictness[second.decision] > strictness[first.decision];
    return {
      analysis: {
        ...device,
        secondOpinion: {
          status: stricter ? "stricter" : "agreed",
          decision: second.decision,
          assessment: cloud.assessment,
          inferenceSource: cloud.inferenceSource,
        },
      },
      decision: stricter
        ? {
            decision: second.decision,
            rationale: [`Gemini Nano would allow it; the cloud second opinion ${decisionWords[second.decision]}.`, ...second.rationale],
          }
        : { decision: first.decision, rationale: [...first.rationale, "The cloud second opinion agreed."] },
    };
  } catch (error) {
    const why = ` (${plainFailure(error)})`;
    return {
      analysis: { ...device, secondOpinion: { status: "unavailable" } },
      decision: {
        decision: "require_approval",
        rationale: [`Gemini Nano would allow it, but the cloud second opinion did not answer${why}, so a person decides.`],
      },
    };
  }
}

const noModel = { assessment: null, inferenceSource: "NONE" } as const;

/**
 * The full control path: hard rules first (no model needed), then risk analysis and
 * policy. Every outcome produces a receipt. An action that must stay on device but
 * cannot be assessed, whose assessment times out, or whose assessor cannot be reached
 * at all (for example offline) fails closed to human approval.
 * When Gemini Nano would allow a call, the cloud gives a second opinion first.
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
    const decision = evaluatePolicy(proposal, analysis.assessment, policy);
    if (
      analysis.inferenceSource === "ON_DEVICE" &&
      decision.decision === "allow" &&
      policy.secondOpinionForDeviceAllows
    ) {
      const checked = await withSecondOpinion(proposal, analysis, decision, options, policy);
      return createDecisionReceipt(proposal, checked.analysis, checked.decision, toolCall);
    }
    return createDecisionReceipt(proposal, analysis, decision, toolCall);
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
    // Any other failure (offline, a refused request, an unusable answer): no assessment,
    // so a person decides. A call is never run, or dropped, because a model was missing.
    return createDecisionReceipt(
      proposal,
      { assessment: null, inferenceSource: "UNAVAILABLE" },
      escalateUnavailable(plainFailure(error)),
      toolCall,
    );
  }
}
