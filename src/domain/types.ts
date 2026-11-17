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

export type InferenceSource = "ON_DEVICE" | "IN_CLOUD" | "UNKNOWN";

export interface AnalysisResult {
  assessment: RiskAssessment;
  inferenceSource: InferenceSource;
}

export interface DecisionReceipt {
  id: string;
  createdAt: string;
  digestAlgorithm: string;
  proposal: ActionProposal;
  assessment: RiskAssessment;
  decision: GuardDecision;
  inferenceSource: InferenceSource;
  digest: string;
}

