import type { InferenceSource, PolicyDecision } from "../domain/types";

export const decisionLabel: Record<PolicyDecision, string> = {
  allow: "Allowed",
  require_approval: "Needs approval",
  deny: "Blocked",
};

export const decisionBadge: Record<PolicyDecision, string> = {
  allow: "badge badge-allow",
  require_approval: "badge badge-review",
  deny: "badge badge-deny",
};

export function duration(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Where the decision was made and how long it took, as one quiet line. */
export function routeLine(source: InferenceSource, ms?: number): string {
  const where =
    source === "ON_DEVICE"
      ? "On device"
      : source === "IN_CLOUD"
        ? "Cloud"
        : source === "NONE"
          ? "Rule, no model call"
          : "Model, source unknown";
  return ms === undefined ? where : `${where}, ${duration(ms)}`;
}

export function formatArgs(args: Record<string, unknown>, maxString = 40): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const text =
        typeof value === "string"
          ? JSON.stringify(value.length > maxString ? `${value.slice(0, maxString - 1)}…` : value)
          : JSON.stringify(value);
      return `${key}: ${text}`;
    })
    .join(", ");
}

export const truncate = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
