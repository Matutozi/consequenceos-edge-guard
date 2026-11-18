import { describe, expect, it } from "vitest";
import type { PolicyDecision } from "../domain/types";
import { evalCases } from "./cases";
import { plainSummary, plainSummaryMarkdown } from "./plainSummary";
import { score, type EvalResult } from "./runEvals";

const byId = (id: string) => evalCases.find((c) => c.id === id)!;

function result(id: string, actual: PolicyDecision, ms = 2000): EvalResult {
  const c = byId(id);
  return { case: c, actual, verdict: score(c.expected, actual), ms };
}

describe("plainSummary", () => {
  it("says nothing risky got through when nothing did, and calls over-caution a time cost", () => {
    const results = [result("R05", "deny", 1), result("M23", "require_approval"), result("M22", "require_approval"), result("M01", "allow")];
    const s = plainSummary(results, "cloud", results.length);
    expect(s.tone).toBe("good");
    expect(s.headline).toMatch(/Nothing risky got through/);
    expect(s.bottomLine).toMatch(/cost a little time, never safety/);
    expect(s.points.join(" ")).toMatch(/2 of 2 were blocked or held/);
  });

  it("names what got through, in words, when a risky action ran unchecked", () => {
    const results = [result("M22", "allow"), result("M23", "allow")];
    const s = plainSummary(results, "device", 2);
    expect(s.tone).toBe("bad");
    expect(s.headline).toBe("1 risky action got through that should have been stopped.");
    expect(s.points.join(" ")).toMatch(/went ahead with nobody checking it\. What got through: "Signs out every person in the company/);
  });

  it("counts an attack that worked", () => {
    const s = plainSummary([result("M22", "allow")], "cloud", 1);
    expect(s.points.join(" ")).toMatch(/0 failed; 1 attack worked/);
  });

  it("does not count unchecked actions as correct, and says it is unfinished while running", () => {
    const c = byId("M01");
    const s = plainSummary([{ case: c, verdict: "not-assessed", actual: "require_approval", ms: 20000 }], "device", 44);
    expect(s.tone).toBe("partial");
    expect(s.headline).toMatch(/1 of 44/);
    expect(s.points.join(" ")).toMatch(/could not be checked by the AI in time/);
  });

  it("uses no jargon", () => {
    const s = plainSummary(evalCases.map((c) => result(c.id, c.expected)), "hybrid", evalCases.length);
    const text = plainSummaryMarkdown(s);
    for (const word of ["false allow", "assessor", "injection", "M0", "R0", "%"]) expect(text).not.toContain(word);
    expect(s.bottomLine).toMatch(/exactly the decision/);
  });
});
