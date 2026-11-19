import { describe, expect, it } from "vitest";
import type { StepState } from "../../agent/useAgentRun";
import { summarize, tourStage } from "./tour";

type Decision = "allow" | "require_approval" | "deny";

function step(
  tool: string,
  decision?: Decision,
  opts: { phase?: StepState["phase"]; source?: string; secondOpinion?: string; logged?: StepState["logged"] } = {},
): StepState {
  return {
    plan: { call: { tool, args: {} } },
    phase: opts.phase ?? (decision === "allow" ? "executed" : decision ? "refused" : "guarding"),
    logged: opts.logged ?? "saved",
    signed: decision && {
      receipt: {
        id: `r-${tool}`,
        decision: { decision },
        inferenceSource: opts.source ?? "NONE",
        secondOpinion: opts.secondOpinion ? { status: opts.secondOpinion } : undefined,
      },
    },
  } as unknown as StepState;
}

describe("tourStage", () => {
  it("starts at the intro before anything runs", () => {
    expect(tourStage([], false, "")).toEqual({ kind: "intro", n: 1 });
  });

  it("is routine while the run goes on with nothing blocked, and never counts back after an approval", () => {
    expect(tourStage([step("read_ticket", "allow")], true, "")).toEqual({ kind: "routine", n: 2 });
    const approved = [step("read_ticket", "allow"), step("disable_user", "require_approval", { phase: "executed" })];
    expect(tourStage(approved, true, "")).toEqual({ kind: "routine", n: 3 });
  });

  it("asks for a decision when a step waits, numbered by whether the attack was already blocked", () => {
    const first = [step("read_ticket", "allow"), step("disable_user", "require_approval", { phase: "awaiting" })];
    expect(tourStage(first, true, "")).toEqual({ kind: "approval", n: 3, tool: "disable_user" });
    const later = [step("export_customers", "deny"), step("email_user", "require_approval", { phase: "awaiting" })];
    expect(tourStage(later, true, "")).toEqual({ kind: "approval", n: 4, tool: "email_user" });
  });

  it("says the attack is stopped once a step is blocked", () => {
    expect(tourStage([step("export_customers", "deny")], true, "").kind).toBe("blocked");
  });

  it("ends on the proof, and reports a failed run instead of a finished one", () => {
    const steps = [step("read_ticket", "allow"), step("export_customers", "deny")];
    expect(tourStage(steps, false, "").kind).toBe("done");
    expect(tourStage(steps, false, "The planner failed")).toEqual({ kind: "failed", n: 4, message: "The planner failed" });
  });
});

describe("summarize", () => {
  it("counts decisions and where they were made, and picks the blocked export as the proof", () => {
    const summary = summarize([
      step("read_ticket", "allow"),
      step("revoke_sessions", "allow", { source: "ON_DEVICE", secondOpinion: "agreed" }),
      step("disable_user", "require_approval", { source: "TIMED_OUT", phase: "executed" }),
      step("delete_audit_logs", "deny"),
      step("export_customers", "deny"),
      step("resolve_ticket", "allow", { source: "IN_CLOUD" }),
      step("add_ticket_note"),
    ]);
    expect(summary).toMatchObject({
      allowed: 3,
      approval: 1,
      blocked: 2,
      byRule: 3,
      onDevice: 1,
      inCloud: 1,
      notAssessed: 1,
      sentToCloud: 2,
      proof: { receiptId: "r-export_customers", tool: "export_customers", logged: true },
    });
  });

  it("says when the proof was not saved to the audit log", () => {
    expect(summarize([step("delete_audit_logs", "deny", { logged: "failed" })]).proof).toEqual({
      receiptId: "r-delete_audit_logs",
      tool: "delete_audit_logs",
      logged: false,
    });
  });
});
