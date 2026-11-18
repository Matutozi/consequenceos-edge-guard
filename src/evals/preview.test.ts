import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../domain/policyConfig";
import type { RiskAssessment } from "../domain/types";
import { defaultRegistry, INTERNAL_DOMAINS } from "../ops/registry";
import { evalCases } from "./cases";
import { previewDraft, summarizePreview, type PolicyDraft } from "./preview";

const live: PolicyDraft = { registry: defaultRegistry, internalDomains: INTERNAL_DOMAINS, policy: DEFAULT_POLICY };
const assessed = (riskLevel: RiskAssessment["riskLevel"], blastRadius: RiskAssessment["blastRadius"]): RiskAssessment => ({
  riskLevel,
  summary: "recorded",
  reasons: [],
  sensitiveData: [],
  blastRadius,
  recommendedControl: "allow",
});
const row = (rows: ReturnType<typeof previewDraft>, id: string) => rows.find((r) => r.case.id === id)!;

describe("previewDraft", () => {
  it("decides every rule case with no assessments at all, exactly as the live guard does", () => {
    const rows = previewDraft(live, {});
    for (const r of rows.filter((x) => x.case.byRule)) expect({ id: r.case.id, verdict: r.verdict }).toEqual({ id: r.case.id, verdict: "pass" });
  });

  it("reports judgement cases with no recorded assessment instead of guessing", () => {
    const rows = previewDraft(live, {});
    const judgement = rows.filter((r) => !r.case.byRule);
    expect(judgement.every((r) => r.verdict === "needs-assessment")).toBe(true);
    expect(summarizePreview(rows).needsAssessment).toBe(judgement.length);
  });

  it("shows the false allow a loosened draft would create, from the same recorded assessment", () => {
    // M10: a $25,000 refund the assessor rated medium risk; it cannot be undone.
    const recorded = { M10: assessed("medium", "single_user") };
    expect(row(previewDraft(live, recorded), "M10").verdict).toBe("pass");
    const loosened = { ...live, policy: { ...DEFAULT_POLICY, irreversibleAllowedUpTo: "medium" as const } };
    const after = row(previewDraft(loosened, recorded), "M10");
    expect(after.decision).toBe("allow");
    expect(after.verdict).toBe("false-allow");
  });

  it("shows when a registry edit moves a case from a rule to the assessor", () => {
    const noFanout = { ...live, registry: { ...defaultRegistry, revoke_sessions: { ...defaultRegistry.revoke_sessions, fanout: undefined } } };
    const m02 = row(previewDraft(noFanout, {}), "M02");
    expect(m02.decidedBy).toBe("none");
    expect(m02.verdict).toBe("needs-assessment");
    // Rated low for one user, as the first cloud run rated M20, it is a false allow.
    expect(row(previewDraft(noFanout, { M02: assessed("low", "single_user") }), "M02").verdict).toBe("false-allow");
    // M20 itself stays caught without the fanout rule: its reason addresses the assessor.
    expect(row(previewDraft(noFanout, {}), "M20")).toMatchObject({ decidedBy: "rule", verdict: "pass" });
  });

  it("counts every case", () => {
    expect(previewDraft(live, {})).toHaveLength(evalCases.length);
  });
});
