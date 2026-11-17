import type { BlastRadius, DataSensitivity, RiskLevel } from "./types";

/**
 * The adjustable part of Edge Guard's policy. Published in Remote Config as
 * `guard_policy`. The floor is not here and cannot be configured: restricted data
 * that cannot be undone is blocked, unknown tools are the worst case, the egress
 * rule applies, sensitive data never goes to the cloud from the console, and a call
 * that cannot be assessed goes to a person.
 */
export interface PolicyConfig {
  /** Risk at or above which a call is blocked. */
  blockAtRisk: "high" | "critical";
  /** Risk at or above which a person approves. */
  approvalAtRisk: "low" | "medium" | "high";
  /** Highest risk at which an action that cannot be undone may run without approval. */
  irreversibleAllowedUpTo: "none" | "low" | "medium";
  /** Data classes that always need a person. */
  approvalForData: DataSensitivity[];
  /** Impact that always needs a person. */
  approvalForImpact: BlastRadius[];
  /** Allow reads of public or internal data by rule, with no model call. */
  fastPathReads: boolean;
  /** Allow low-impact changes that can be undone, on public or internal data, by rule. */
  fastPathLowImpact: boolean;
  /** Target values that mean "everyone" for a tool's fanout argument. */
  wildcardTargets: string[];
  /** Seconds the assessor may take before the call goes to a person. */
  assessorTimeoutSeconds: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  blockAtRisk: "critical",
  approvalAtRisk: "high",
  irreversibleAllowedUpTo: "low",
  approvalForData: ["confidential", "restricted"],
  approvalForImpact: ["organization", "public"],
  fastPathReads: true,
  fastPathLowImpact: true,
  wildcardTargets: ["all", "*", "everyone", "everybody", "all users", "every user", "any"],
  assessorTimeoutSeconds: 20,
};

/** The value each field falls back to when it is malformed: the strictest one. */
const STRICTEST: PolicyConfig = {
  blockAtRisk: "high",
  approvalAtRisk: "low",
  irreversibleAllowedUpTo: "none",
  approvalForData: ["public", "internal", "confidential", "restricted"],
  approvalForImpact: ["single_user", "team", "organization", "public"],
  fastPathReads: false,
  fastPathLowImpact: false,
  wildcardTargets: DEFAULT_POLICY.wildcardTargets,
  assessorTimeoutSeconds: DEFAULT_POLICY.assessorTimeoutSeconds,
};

export const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
export const riskRank = (level: RiskLevel | "none") => (level === "none" ? -1 : RISK_ORDER.indexOf(level));

const DATA: DataSensitivity[] = ["public", "internal", "confidential", "restricted"];
const IMPACT: BlastRadius[] = ["single_user", "team", "organization", "public"];

const oneOf = <T extends string>(allowed: readonly T[]) => (v: unknown): v is T => allowed.includes(v as T);
const subsetOf = <T extends string>(allowed: readonly T[]) => (v: unknown): v is T[] =>
  Array.isArray(v) && v.every((x) => allowed.includes(x as T));

const checks: { [K in keyof PolicyConfig]: (v: unknown) => boolean } = {
  blockAtRisk: oneOf(["high", "critical"] as const),
  approvalAtRisk: oneOf(["low", "medium", "high"] as const),
  irreversibleAllowedUpTo: oneOf(["none", "low", "medium"] as const),
  approvalForData: subsetOf(DATA),
  approvalForImpact: subsetOf(IMPACT),
  fastPathReads: (v) => typeof v === "boolean",
  fastPathLowImpact: (v) => typeof v === "boolean",
  wildcardTargets: (v) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim().length > 0 && x.length <= 40),
  assessorTimeoutSeconds: (v) => typeof v === "number" && Number.isFinite(v) && v >= 5 && v <= 60,
};

export interface ParsedPolicy {
  policy: PolicyConfig;
  /** Fields that were missing or malformed and fell back to their strictest value. */
  tightened: (keyof PolicyConfig)[];
}

/**
 * Validates a policy field by field. A missing or malformed field takes its strictest
 * value, so a bad config can only make Edge Guard stricter, never looser.
 */
export function parsePolicy(value: unknown): ParsedPolicy {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const policy = { ...STRICTEST } as Record<keyof PolicyConfig, unknown>;
  const tightened: (keyof PolicyConfig)[] = [];
  for (const key of Object.keys(checks) as (keyof PolicyConfig)[]) {
    if (checks[key](raw[key])) policy[key] = raw[key];
    else tightened.push(key);
  }
  const result = policy as unknown as PolicyConfig;
  result.wildcardTargets = result.wildcardTargets.map((t) => t.trim().toLowerCase());
  return { policy: result, tightened };
}
