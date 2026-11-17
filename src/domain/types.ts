export type DataSensitivity = "public" | "internal" | "confidential" | "restricted";

export interface ActionProposal {
  actor: string;
  action: string;
  target: string;
  context: string;
  dataSensitivity: DataSensitivity;
  reversible: boolean;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type BlastRadius = "single_user" | "team" | "organization" | "public";
export type RecommendedControl = "allow" | "require_approval" | "block";
export type PolicyDecision = "allow" | "require_approval" | "deny";

export interface RiskAssessment {
  riskLevel: RiskLevel;
  summary: string;
  reasons: string[];
  sensitiveData: string[];
  blastRadius: BlastRadius;
  recommendedControl: RecommendedControl;
}

export interface GuardDecision {
  decision: PolicyDecision;
  rationale: string[];
}

/**
 * `NONE`: no model was called; the decision came from deterministic policy alone.
 * `TIMED_OUT`: a model was asked but did not answer in time, so the request was aborted.
 */
export type InferenceSource = "ON_DEVICE" | "IN_CLOUD" | "UNKNOWN" | "NONE" | "TIMED_OUT";

export interface AnalysisResult {
  assessment: RiskAssessment;
  inferenceSource: InferenceSource;
}

/** What a receipt records about analysis; `assessment` is null when no model ran. */
export interface ReceiptAnalysis {
  assessment: RiskAssessment | null;
  inferenceSource: InferenceSource;
}

/** The exact call an agent asked to run. A receipt authorizes this call and no other. */
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
}

export interface DecisionReceipt {
  id: string;
  createdAt: string;
  digestAlgorithm: string;
  proposal: ActionProposal;
  assessment: RiskAssessment | null;
  decision: GuardDecision;
  inferenceSource: InferenceSource;
  toolCall?: ToolCallRecord;
  digest: string;
}

