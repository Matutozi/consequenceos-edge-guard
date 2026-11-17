import baseline from "./baseline-assessments.json";
import type { AssessmentSet } from "./preview";

const KEY = "edge-guard-eval-assessments";

/** Assessments recorded by the cloud eval run published in the README. Committed with the code. */
export const baselineAssessments = baseline as AssessmentSet;

/** The viewer's own last eval run, kept in this browser. */
export function loadLastRun(): AssessmentSet | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as AssessmentSet) : undefined;
    return parsed && parsed.assessments && typeof parsed.assessments === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveLastRun(set: AssessmentSet): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(set));
  } catch {
    // Storage unavailable: the Policy page falls back to the baseline.
  }
}
