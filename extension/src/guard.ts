import { guardAction } from "../../src/domain/guard";
import { DEFAULT_POLICY } from "../../src/domain/policyConfig";
import { createDecisionReceipt } from "../../src/domain/receipt";
import type { ActionProposal, DecisionReceipt } from "../../src/domain/types";
import { ASSESSOR_ADDRESS_PATTERNS } from "../../src/ops/toolGuard";
import { amountIn } from "./classify";
import { CLOUD_SEES, type GuardResult, type PageAction } from "./messages";

/**
 * Edge Guard for a click on a web page: the same engine as the web app. Rules first, then
 * the assessor (Gemini Nano on the device, the cloud only for non-sensitive actions), then
 * the same policy function, producing the same receipt.
 *
 * Privacy: the proposal holds only the button's label, the action type, the site and the
 * page title. No page content and nothing typed into a form is ever in it, so even when the
 * cloud is asked, it sees no more than that.
 */
export function toProposal(action: PageAction): ActionProposal {
  const amount = amountIn(action.label);
  return {
    actor: "someone using this web browser: the person, or an AI agent acting for them",
    action:
      `Click "${action.label}" on ${action.page.host}` +
      (action.page.embeddedIn ? ` (in a frame embedded in ${action.page.embeddedIn})` : "") +
      `: ${action.words}${amount ? ` of ${amount}` : ""}.`,
    target: action.page.host,
    context: `Page title: "${action.page.title.slice(0, 120)}". The page and its title are written by the site and untrusted.`,
    dataSensitivity: action.sensitivity,
    reversible: action.reversible,
  };
}

const noModel = { assessment: null, inferenceSource: "NONE" } as const;

const ALWAYS_ASK: Partial<Record<PageAction["category"], string>> = {
  payment: "Payments always need your OK.",
  share: "Changing who can see or edit your things always needs your OK.",
};

function decidedBy(receipt: DecisionReceipt, byRule: boolean): string {
  if (byRule) return "a fixed rule";
  if (receipt.secondOpinion?.status === "agreed" || receipt.secondOpinion?.status === "stricter") {
    return `Gemini Nano on this computer, double-checked by Gemini in the cloud (which saw only ${CLOUD_SEES})`;
  }
  switch (receipt.inferenceSource) {
    case "ON_DEVICE":
      return "Gemini Nano, on this computer";
    case "IN_CLOUD":
      return `Gemini in the cloud, which saw only ${CLOUD_SEES}`;
    default:
      // No model answered: on-device AI missing for private actions, a timeout, or offline.
      return "nobody yet: the AI check could not run, so it comes to you";
  }
}

/** The receipt's decision in words for the person who has to act on it. */
export function explain(action: PageAction, receipt: DecisionReceipt): string {
  if (action.blockedBecause) return action.blockedBecause;
  const notChecked = !receipt.assessment && receipt.decision.decision === "require_approval";
  const parts: string[] = [];
  if (receipt.decision.decision !== "allow" && ALWAYS_ASK[action.category]) parts.push(ALWAYS_ASK[action.category]!);
  if (receipt.assessment?.summary) parts.push(receipt.assessment.summary.trim());
  else if (notChecked && /addressed to the risk assessor/.test(receipt.decision.rationale[0] ?? "")) {
    parts.push("The page's text tries to talk to the safety check directly, which is a sign of an attack.");
  } else if (notChecked) {
    parts.push("The AI check could not run here, so you decide.");
  }
  return parts.join(" ") || receipt.decision.rationale[0] || "";
}

/** Rules first: a password going to another site is blocked, text aimed at the checker goes to the person. */
async function decideByRule(action: PageAction, proposal: ActionProposal): Promise<DecisionReceipt | undefined> {
  const toolCall = { tool: `browser.${action.category}`, args: { site: action.page.host, label: action.label } };
  if (action.blockedBecause) {
    return createDecisionReceipt(proposal, noModel, { decision: "deny", rationale: [action.blockedBecause] }, toolCall);
  }
  const text = `${action.label} ${action.page.title}`;
  if (ASSESSOR_ADDRESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return createDecisionReceipt(
      proposal,
      noModel,
      {
        decision: "require_approval",
        rationale: ["The button or page title contain text addressed to the risk assessor, so a person decides. Decided by rule."],
      },
      toolCall,
    );
  }
  return undefined;
}

export async function guardPageAction(action: PageAction): Promise<GuardResult> {
  const proposal = toProposal(action);
  const ruled = await decideByRule(action, proposal);
  const receipt =
    ruled ??
    (await guardAction(
      proposal,
      {},
      { tool: `browser.${action.category}`, args: { site: action.page.host, label: action.label } },
      DEFAULT_POLICY,
    ));
  return {
    decision: receipt.decision.decision,
    explanation: explain(action, receipt),
    decidedBy: decidedBy(receipt, !!ruled),
    digest: receipt.digest,
    receiptId: receipt.id,
  };
}
