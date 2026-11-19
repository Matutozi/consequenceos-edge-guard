import { el } from "./dom";
import { pendingKey, type HistoryItem, type Pending, type ToBackground, type ToContent } from "./messages";
import { automationWarning } from "./trust";

/**
 * The approval window. It is an extension page in its own window, so the page that asked, and
 * an agent working through that page, cannot press its buttons. An agent that drives the whole
 * browser or computer can; see trust.ts.
 */
const main = document.getElementById("main")!;
const id = new URLSearchParams(location.search).get("id") ?? "";

async function decide(pending: Pending, allow: boolean): Promise<void> {
  // Removed first, so closing the window afterwards does not also count as a block.
  await chrome.storage.session.remove(pendingKey(pending.id));
  const decision: ToContent = { type: "decision", id: pending.id, allow };
  await chrome.tabs.sendMessage(pending.tabId, decision, { frameId: pending.frameId ?? 0 }).catch(() => undefined);
  const item: HistoryItem = {
    at: new Date().toISOString(),
    site: pending.action.page.host,
    label: pending.action.label,
    words: pending.action.words,
    outcome: allow ? "allowed" : "blocked",
    by: pending.result.decision === "deny" && allow ? "you, overriding the block" : "you",
    explanation: pending.result.explanation,
    digest: pending.result.digest,
  };
  const record: ToBackground = { type: "record", item };
  await chrome.runtime.sendMessage(record).catch(() => undefined);
  window.close();
}

async function render(): Promise<void> {
  const { [pendingKey(id)]: pending } = (await chrome.storage.session.get(pendingKey(id))) as Record<string, Pending | undefined>;
  if (!pending) {
    main.replaceChildren(el("p", { text: "This request has already been answered." }));
    return;
  }
  const blocked = pending.result.decision === "deny";
  const automationNotice = automationWarning(navigator);
  document.title = blocked ? "Edge Guard blocked an action" : "Edge Guard: your answer is needed";

  const allow = el("button", { className: blocked ? "" : "primary", text: blocked ? "Allow anyway" : "Allow once" });
  const block = el("button", { className: blocked ? "danger" : "", text: blocked ? "Keep it blocked" : "Block" });
  allow.addEventListener("click", async () => {
    if (blocked && !confirm("Edge Guard blocked this for a reason. Allow it anyway?")) return;
    await decide(pending, true);
  });
  block.addEventListener("click", () => void decide(pending, false));

  main.replaceChildren(
    el("h1", { text: blocked ? "Blocked" : "Is this what you want?" }),
    el(
      "div",
      { className: blocked ? "box deny" : "box review" },
      el("p", {
        text: `Edge Guard ${blocked ? "stopped" : "paused"} ${pending.action.words} ${pending.action.category === "credentials" ? "from" : "on"} ${pending.action.page.host}.`,
      }),
    ),
    el(
      "dl",
      {},
      el("dt", { text: "Site" }),
      el("dd", { text: pending.action.page.host }),
      ...(pending.action.page.embeddedIn
        ? [el("dt", { text: "Inside" }), el("dd", { text: `a frame on ${pending.action.page.embeddedIn}` })]
        : []),
      el("dt", { text: "Button" }),
      el("dd", { text: `“${pending.action.label}”` }),
      el("dt", { text: "Why" }),
      el("dd", { text: pending.result.explanation }),
      el("dt", { text: "Checked by" }),
      el("dd", { text: pending.result.decidedBy }),
    ),
    el(
      "p",
      { className: "muted" },
      "If you didn't click this yourself, an AI agent or the page may have. When in doubt, block it.",
    ),
    ...(automationNotice ? [el("div", { className: "box deny", role: "alert" }, el("p", { text: automationNotice }))] : []),
    el("div", { className: "actions" }, block, allow),
    el("p", { className: "muted mono", text: `Receipt ${pending.result.digest.slice(0, 16)}…` }),
  );
  // Block has focus, so a stray Enter key can never approve anything.
  block.focus();
}

void render();
