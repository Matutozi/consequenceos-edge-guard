import { describe, expect, it } from "vitest";
import { defaultRegistry } from "../ops/registry";
import { decideByRules } from "../ops/toolGuard";
import { evaluatePolicy } from "./policy";
import { DEFAULT_POLICY, parsePolicy, type PolicyConfig } from "./policyConfig";
import type { ActionProposal, RiskAssessment } from "./types";

const proposal: ActionProposal = {
  actor: "agent",
  action: "revoke_sessions",
  target: "identity provider",
  context: "test",
  dataSensitivity: "internal",
  reversible: true,
};
const assessment = (riskLevel: RiskAssessment["riskLevel"], blastRadius: RiskAssessment["blastRadius"] = "single_user"): RiskAssessment => ({
  riskLevel,
  summary: "s",
  reasons: [],
  sensitiveData: [],
  blastRadius,
  recommendedControl: "allow",
});
const withPolicy = (change: Partial<PolicyConfig>) => ({ ...DEFAULT_POLICY, ...change });

describe("parsePolicy", () => {
  it("accepts the default policy unchanged", () => {
    expect(parsePolicy(DEFAULT_POLICY)).toEqual({ policy: DEFAULT_POLICY, tightened: [] });
  });

  it("tightens each malformed field to its strictest value, and only that field", () => {
    const { policy, tightened } = parsePolicy({ ...DEFAULT_POLICY, approvalAtRisk: "never", fastPathReads: "yes", assessorTimeoutSeconds: 600 });
    expect(tightened).toEqual(["approvalAtRisk", "fastPathReads", "assessorTimeoutSeconds"]);
    expect(policy.approvalAtRisk).toBe("low");
    expect(policy.fastPathReads).toBe(false);
    expect(policy.assessorTimeoutSeconds).toBe(20);
    expect(policy.blockAtRisk).toBe("critical");
  });

  it("treats a missing or non-object policy as the strictest one", () => {
    const { policy, tightened } = parsePolicy("not a policy");
    expect(tightened).toHaveLength(Object.keys(DEFAULT_POLICY).length);
    expect(policy.blockAtRisk).toBe("high");
    expect(policy.approvalForData).toHaveLength(4);
  });

  it("cannot be used to drop the critical block by naming an unknown level", () => {
    expect(parsePolicy({ ...DEFAULT_POLICY, blockAtRisk: "never" }).policy.blockAtRisk).toBe("high");
  });
});

describe("evaluatePolicy with a configured policy", () => {
  it("blocks high risk when the policy says so", () => {
    expect(evaluatePolicy(proposal, assessment("high"), withPolicy({ blockAtRisk: "high" })).decision).toBe("deny");
    expect(evaluatePolicy(proposal, assessment("high")).decision).toBe("require_approval");
  });

  it("asks a person from medium risk when the policy says so", () => {
    expect(evaluatePolicy(proposal, assessment("medium"), withPolicy({ approvalAtRisk: "medium" })).decision).toBe("require_approval");
    expect(evaluatePolicy(proposal, assessment("medium")).decision).toBe("allow");
  });

  it("can require approval for every irreversible action", () => {
    const irreversible = { ...proposal, reversible: false };
    expect(evaluatePolicy(irreversible, assessment("low")).decision).toBe("allow");
    expect(evaluatePolicy(irreversible, assessment("low"), withPolicy({ irreversibleAllowedUpTo: "none" })).decision).toBe("require_approval");
  });

  it("follows the configured data classes and impact", () => {
    const loose = withPolicy({ approvalForData: [], approvalForImpact: [] });
    expect(evaluatePolicy({ ...proposal, dataSensitivity: "confidential" }, assessment("low", "organization"), loose).decision).toBe("allow");
    expect(evaluatePolicy(proposal, assessment("low", "team"), withPolicy({ approvalForImpact: ["team"] })).decision).toBe("require_approval");
  });

  it("never lets a policy lift the hard rule on restricted data that cannot be undone", () => {
    const loosest = withPolicy({ blockAtRisk: "critical", approvalAtRisk: "high", irreversibleAllowedUpTo: "medium", approvalForData: [], approvalForImpact: [] });
    expect(evaluatePolicy({ ...proposal, dataSensitivity: "restricted", reversible: false }, assessment("low"), loosest).decision).toBe("deny");
  });
});

describe("decideByRules", () => {
  it("allows reads and low-impact notes by rule, unless the policy turns the fast paths off", () => {
    const read = { tool: "read_ticket", args: { ticketId: 1 } };
    const note = { tool: "add_ticket_note", args: { ticketId: 1, note: "x" } };
    expect(decideByRules(read, defaultRegistry)?.decision).toBe("allow");
    expect(decideByRules(note, defaultRegistry)?.decision).toBe("allow");
    const off = withPolicy({ fastPathReads: false, fastPathLowImpact: false });
    expect(decideByRules(read, defaultRegistry, undefined, off)).toBeUndefined();
    expect(decideByRules(note, defaultRegistry, undefined, off)).toBeUndefined();
  });

  it("uses the policy's wildcard list for the fanout rule", () => {
    const call = { tool: "revoke_sessions", args: { userId: "staff" } };
    expect(decideByRules(call, defaultRegistry)).toBeUndefined();
    expect(decideByRules(call, defaultRegistry, undefined, withPolicy({ wildcardTargets: ["staff"] }))?.decision).toBe("require_approval");
  });

  it("leaves real judgement to the assessor", () => {
    expect(decideByRules({ tool: "revoke_sessions", args: { userId: "ada.okafor" } }, defaultRegistry)).toBeUndefined();
  });
});
