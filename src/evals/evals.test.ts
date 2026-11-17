import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const analyzeAction = vi.hoisted(() => vi.fn());

vi.mock("../ai/analyzeAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/analyzeAction")>()),
  analyzeAction,
}));

const { evalCases } = await import("./cases");
const { runCase, runEvals, score, summarize } = await import("./runEvals");
const { createSigner } = await import("../ops/signing");

let signer: Awaited<ReturnType<typeof createSigner>>;
beforeAll(async () => {
  signer = await createSigner();
});
beforeEach(() => {
  analyzeAction.mockReset();
});

describe("eval set", () => {
  it("has 30 to 50 cases with unique IDs, both groups well represented", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(30);
    expect(evalCases.length).toBeLessThanOrEqual(50);
    expect(new Set(evalCases.map((c) => c.id)).size).toBe(evalCases.length);
    expect(evalCases.filter((c) => c.byRule).length).toBeGreaterThanOrEqual(15);
    expect(evalCases.filter((c) => !c.byRule).length).toBeGreaterThanOrEqual(15);
    expect(evalCases.filter((c) => c.category === "injection").length).toBeGreaterThanOrEqual(8);
  });

  it("decides every rule case correctly without calling a model", async () => {
    analyzeAction.mockImplementation(async () => {
      throw new Error("a model must not be called for rule cases");
    });
    const results = await runEvals(evalCases, "rules", signer);
    expect(results).toHaveLength(evalCases.filter((c) => c.byRule).length);
    for (const r of results) expect({ id: r.case.id, verdict: r.verdict }).toEqual({ id: r.case.id, verdict: "pass" });
    expect(analyzeAction).not.toHaveBeenCalled();
  });

  it("sends every judgement case to the assessor", async () => {
    analyzeAction.mockResolvedValue({
      assessment: { riskLevel: "low", summary: "s", reasons: [], sensitiveData: [], blastRadius: "single_user", recommendedControl: "allow" },
      inferenceSource: "IN_CLOUD",
    });
    for (const c of evalCases.filter((c) => !c.byRule)) {
      analyzeAction.mockClear();
      await runCase(c, "cloud", signer);
      expect({ id: c.id, calls: analyzeAction.mock.calls.length }).toEqual({ id: c.id, calls: 1 });
      expect(analyzeAction.mock.calls[0][1].route).toBe("cloud");
    }
  });
});

describe("rate limits", () => {
  it("retries a case that hit the per-minute limit instead of scoring it", async () => {
    const c = evalCases.find((x) => !x.byRule)!;
    let calls = 0;
    analyzeAction.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("[429 ] You exceeded your current quota");
      return {
        assessment: { riskLevel: "low", summary: "s", reasons: [], sensitiveData: [], blastRadius: "single_user", recommendedControl: "allow" },
        inferenceSource: "IN_CLOUD",
      };
    });
    const [result] = await runEvals([c], "cloud", signer, { rateLimitWaitMs: 1 });
    expect(calls).toBe(2);
    expect(result.verdict).not.toBe("error");
  });
});

describe("scoring", () => {
  it("separates false allows from over-escalation", () => {
    expect(score("deny", "allow")).toBe("false-allow");
    expect(score("require_approval", "allow")).toBe("false-allow");
    expect(score("allow", "require_approval")).toBe("stricter");
    expect(score("deny", "deny")).toBe("pass");
  });

  it("does not credit a judgement case that never reached the model", async () => {
    const c = evalCases.find((x) => x.id === "M21")!;
    analyzeAction.mockResolvedValue({
      assessment: { riskLevel: "high", summary: "s", reasons: [], sensitiveData: [], blastRadius: "organization", recommendedControl: "require_approval" },
      inferenceSource: "IN_CLOUD",
    });
    // Asked for the device route, but the answer came from the cloud.
    expect((await runCase(c, "device", signer)).verdict).toBe("not-assessed");
  });

  it("summarizes without counting unscored cases", () => {
    const base = evalCases[0];
    const s = summarize([
      { case: base, verdict: "pass", ms: 10 },
      { case: base, verdict: "false-allow", ms: 30 },
      { case: base, verdict: "not-assessed" },
    ]);
    expect(s).toMatchObject({ total: 3, scored: 2, pass: 1, falseAllow: 1, notAssessed: 1 });
  });
});
