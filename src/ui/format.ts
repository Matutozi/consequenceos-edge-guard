import type { DecisionReceipt, InferenceSource, PolicyDecision } from "../domain/types";

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
          : source === "TIMED_OUT"
            ? "Assessor timed out"
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

/** True when the call itself was sent to the cloud: a cloud check or a second opinion. */
export function wentToCloud(receipt: Pick<DecisionReceipt, "inferenceSource" | "secondOpinion">): boolean {
  const asked = receipt.secondOpinion?.status;
  return receipt.inferenceSource === "IN_CLOUD" || asked === "agreed" || asked === "stricter" || asked === "unavailable";
}

/** routeLine, aware of the cloud second opinion on Gemini Nano's allows. */
export function receiptRoute(receipt: Pick<DecisionReceipt, "inferenceSource" | "secondOpinion">, ms?: number): string {
  const asked = receipt.secondOpinion?.status;
  if (receipt.inferenceSource === "ON_DEVICE" && (asked === "agreed" || asked === "stricter" || asked === "unavailable")) {
    return ms === undefined ? "On device, then cloud second opinion" : `On device, then cloud second opinion, ${duration(ms)}`;
  }
  return routeLine(receipt.inferenceSource, ms);
}
