import type { StepState } from "../../agent/useAgentRun";
import { wentToCloud } from "../format";

/** The guided tour runs the recorded attack on this ticket. */
export const TOUR_TICKET_ID = "sample:482";
export const TOUR_STEPS = 5;

export type TourStage =
  | { kind: "intro"; n: 1 }
  | { kind: "routine"; n: 2 | 3 }
  | { kind: "approval"; n: 3 | 4; tool: string }
  | { kind: "blocked"; n: 4 }
  | { kind: "done"; n: 5; summary: TourSummary }
  | { kind: "failed"; n: number; message: string };

export interface TourSummary {
  allowed: number;
  approval: number;
  blocked: number;
  /** Decided by a rule, with no model asked. */
  byRule: number;
  onDevice: number;
  inCloud: number;
  /** A model was needed but could not answer in time, so a person decided. */
  notAssessed: number;
  /** Calls sent to the cloud at all: cloud checks and second opinions. */
  sentToCloud: number;
  /** The receipt to verify: the blocked export when there is one, else the first block. */
  proof?: { receiptId: string; tool: string; logged: boolean };
}

const decisionOf = (s: StepState) => s.signed?.receipt.decision.decision;

/** Where the tour is, worked out from the run itself, so it never runs ahead of what is on screen. */
export function tourStage(steps: StepState[], running: boolean, runError: string): TourStage {
  const anyBlocked = steps.some((s) => decisionOf(s) === "deny");
  if (runError && !running) return { kind: "failed", n: anyBlocked ? 4 : 2, message: runError };
  const waiting = steps.find((s) => s.phase === "awaiting");
  if (waiting) return { kind: "approval", n: anyBlocked ? 4 : 3, tool: waiting.plan.call.tool };
  if (running) {
    if (anyBlocked) return { kind: "blocked", n: 4 };
    // After the first approval, stay on 3 so the tour never counts backwards.
    return { kind: "routine", n: steps.some((s) => decisionOf(s) === "require_approval") ? 3 : 2 };
  }
  if (steps.length === 0) return { kind: "intro", n: 1 };
  return { kind: "done", n: 5, summary: summarize(steps) };
}

export function summarize(steps: StepState[]): TourSummary {
  const decided = steps.filter((s) => s.signed);
  const count = (pred: (s: StepState) => boolean) => decided.filter(pred).length;
  const source = (s: StepState) => s.signed!.receipt.inferenceSource;
  const blocked = decided.filter((s) => decisionOf(s) === "deny");
  const proofStep = blocked.find((s) => s.plan.call.tool === "export_customers") ?? blocked[0];
  return {
    allowed: count((s) => decisionOf(s) === "allow"),
    approval: count((s) => decisionOf(s) === "require_approval"),
    blocked: blocked.length,
    byRule: count((s) => source(s) === "NONE"),
    onDevice: count((s) => source(s) === "ON_DEVICE"),
    inCloud: count((s) => source(s) === "IN_CLOUD"),
    notAssessed: count((s) => source(s) === "TIMED_OUT" || source(s) === "UNAVAILABLE"),
    sentToCloud: count((s) => wentToCloud(s.signed!.receipt)),
    proof: proofStep && {
      receiptId: proofStep.signed!.receipt.id,
      tool: proofStep.plan.call.tool,
      logged: proofStep.logged === "saved",
    },
  };
}
