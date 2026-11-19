import { classifyAction, type ActionSignals } from "./classify";
import { contrast, triage, type HiddenHow, type TextBlock } from "./injection";
import { ENABLED_KEY, type GuardResponse, type PageAction, type ScanReport, type ToBackground, type ToContent } from "./messages";

/**
 * Runs in every page. Stops consequential clicks and submissions until Edge Guard has
 * decided, replays them when allowed, and gathers the page's hidden text for the scanner.
 * It reads labels and form structure only, never what is typed into a form.
 */

let enabled = true;
void (async () => {
  const stored = await chrome.storage.local.get(ENABLED_KEY);
  enabled = stored[ENABLED_KEY] !== false;
})();
chrome.storage.onChanged.addListener((changes) => {
  if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue !== false;
});

/** False once the extension is reloaded or removed: this script can no longer reach it. */
const alive = () => !!chrome.runtime?.id;

// ---------------------------------------------------------------- actions

const CONTROLS =
  'button, a, input[type="submit"], input[type="button"], input[type="image"], [role="button"], [role="link"], [role="menuitem"]';
const CARD_FIELDS =
  'input[autocomplete~="cc-number"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="ccnum" i], input[id*="cardnumber" i], input[id*="card-number" i]';

/** Elements and forms allowed once, so the replayed click or submit passes through. */
const passes = new WeakSet<Element>();
const pendingReplays = new Map<string, () => void>();

function labelOf(el: Element): string {
  const input = el as HTMLInputElement;
  return (
    (el instanceof HTMLInputElement ? input.value : "") ||
    el.getAttribute("aria-label") ||
    (el as HTMLElement).innerText ||
    el.getAttribute("title") ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return el.type === "submit";
  return el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image");
}

function signalsFor(el: Element | null, form: HTMLFormElement | null, label: string): ActionSignals {
  const submits = !el || isSubmitControl(el);
  let formActionHost: string | undefined;
  try {
    formActionHost = form?.getAttribute("action") ? new URL(form.action).host : undefined;
  } catch {
    formActionHost = undefined;
  }
  return {
    label,
    pageHost: location.host,
    formActionHost,
    formHasCardField: submits && !!form?.querySelector(CARD_FIELDS),
    // Whether a password was typed, never what it is.
    formHasPassword: submits && [...(form?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [])].some((i) => i.value.length > 0),
  };
}

function pageAction(signals: ActionSignals): PageAction | undefined {
  const classified = classifyAction(signals);
  if (!classified) return undefined;
  return {
    label: signals.label || "Submit",
    category: classified.category,
    words: classified.words,
    sensitivity: classified.sensitivity as PageAction["sensitivity"],
    reversible: classified.reversible,
    blockedBecause: classified.blockedBecause,
    page: { host: location.host, title: document.title },
  };
}

async function check(action: PageAction, replay: () => void): Promise<void> {
  toast("checking", `Edge Guard is checking: ${action.words}.`);
  let response: GuardResponse | { error: string };
  try {
    response = await chrome.runtime.sendMessage<ToBackground, GuardResponse | { error: string }>({ type: "guard-action", action });
  } catch {
    response = { error: "Edge Guard is not responding." };
  }
  if ("error" in response) {
    toast("blocked", `Stopped: Edge Guard could not check this (${response.error}). Try again.`);
    return;
  }
  if (response.status === "allow") {
    toast("allowed", `Allowed. ${response.result.explanation}`);
    replay();
    return;
  }
  pendingReplays.set(response.id, replay);
  toast(
    response.result.decision === "deny" ? "blocked" : "waiting",
    response.result.decision === "deny"
      ? "Blocked. See the Edge Guard window for why, and to override it."
      : "Waiting for your answer in the Edge Guard window.",
  );
}

function onClick(event: MouseEvent): void {
  if (!enabled || !alive()) return;
  const el = (event.target as Element | null)?.closest?.(CONTROLS);
  if (!el) return;
  if (passes.has(el)) {
    passes.delete(el);
    return;
  }
  const form = (el as HTMLButtonElement).form ?? el.closest("form");
  const action = pageAction(signalsFor(el, form, labelOf(el)));
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void check(action, () => {
    passes.add(el);
    if (form && isSubmitControl(el)) passes.add(form);
    (el as HTMLElement).click();
  });
}

/** Submissions without a click (pressing Enter), on forms with card or password fields. */
function onSubmit(event: SubmitEvent): void {
  if (!enabled || !alive()) return;
  const form = event.target as HTMLFormElement;
  if (passes.has(form)) {
    passes.delete(form);
    return;
  }
  const submitter = event.submitter;
  const action = pageAction(signalsFor(null, form, submitter ? labelOf(submitter) : ""));
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void check(action, () => {
    passes.add(form);
    form.requestSubmit(submitter ?? undefined);
  });
}

window.addEventListener("click", onClick, true);
window.addEventListener("submit", onSubmit, true);

chrome.runtime.onMessage.addListener((message: ToContent) => {
  if (message.type === "decision") {
    const replay = pendingReplays.get(message.id);
    pendingReplays.delete(message.id);
    if (!replay) return;
    if (message.allow) {
      toast("allowed", "You allowed it.");
      replay();
    } else {
      toast("blocked", "Blocked. Nothing was sent.");
    }
  } else if (message.type === "scan-now") {
    void scan();
  }
});

// ---------------------------------------------------------------- page UI

let host: HTMLElement | undefined;
let root: ShadowRoot | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const STYLE = `
  :host { all: initial; }
  .wrap { position: fixed; top: 16px; right: 16px; z-index: 2147483647; display: grid; gap: 8px; width: min(360px, calc(100vw - 32px));
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { background: #fff; color: #111827; border: 1px solid #e5e7eb; border-left-width: 4px; border-radius: 10px;
    padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); }
  .checking, .waiting { border-left-color: #a16207; } .allowed { border-left-color: #15803d; } .blocked, .warning { border-left-color: #b91c1c; }
  strong { display: block; margin-bottom: 2px; }
  ul { margin: 6px 0 0; padding-left: 18px; } li { margin: 4px 0; } q { color: #374151; }
  button { margin-top: 8px; font: inherit; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 3px 10px; cursor: pointer; color: #111827; }
  @media (prefers-color-scheme: dark) { .card { background: #1f2937; color: #f9fafb; border-color: #374151; } q { color: #d1d5db; }
    button { background: #374151; color: #f9fafb; border-color: #4b5563; } }
`;

function ui(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement("edge-guard-ui");
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${STYLE}</style><div class="wrap"><div class="slot-toast"></div><div class="slot-warning"></div></div>`;
  document.documentElement.append(host);
  return root;
}

function toast(kind: "checking" | "waiting" | "allowed" | "blocked", text: string): void {
  const slot = ui().querySelector(".slot-toast")!;
  slot.replaceChildren();
  const card = document.createElement("div");
  card.className = `card ${kind}`;
  card.setAttribute("role", kind === "blocked" ? "alert" : "status");
  const title = document.createElement("strong");
  title.textContent = "Edge Guard";
  card.append(title, document.createTextNode(text));
  slot.append(card);
  clearTimeout(toastTimer);
  if (kind === "allowed" || kind === "blocked") toastTimer = setTimeout(() => slot.replaceChildren(), 6000);
}

function showWarning(report: ScanReport): void {
  const slot = ui().querySelector(".slot-warning")!;
  slot.replaceChildren();
  if (report.findings.length === 0) return;
  const card = document.createElement("div");
  card.className = "card warning";
  card.setAttribute("role", "alert");
  const title = document.createElement("strong");
  const n = report.findings.length;
  title.textContent = `This page hides ${n === 1 ? "an instruction" : `${n} instructions`} aimed at AI`;
  const intro = document.createElement("div");
  intro.textContent = "Don't let an AI agent act on this page without watching it.";
  const list = document.createElement("ul");
  for (const finding of report.findings.slice(0, 3)) {
    const item = document.createElement("li");
    const quote = document.createElement("q");
    quote.textContent = finding.text.length > 140 ? `${finding.text.slice(0, 139)}…` : finding.text;
    item.append(quote, document.createTextNode(` ${finding.why}`));
    list.append(item);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Dismiss";
  close.addEventListener("click", () => slot.replaceChildren());
  card.append(title, intro, list, close);
  slot.append(card);
}

// ---------------------------------------------------------------- injection scan

const MAX_NODES = 4000;

function backgroundOf(el: Element | null): string {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
  }
  return "rgb(255, 255, 255)";
}

function hiddenHow(el: Element): HiddenHow | undefined {
  if (el.closest("edge-guard-ui")) return undefined;
  const style = getComputedStyle(el);
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || parseFloat(style.opacity) < 0.05) return "invisible";
  if (parseFloat(style.fontSize) < 4) return "tiny text";
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return "invisible";
  if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0 || rect.left + scrollX > document.documentElement.scrollWidth + 500) {
    return "placed off the screen";
  }
  const ratio = contrast(style.color, backgroundOf(el));
  if (ratio !== undefined && ratio < 1.2) return "the same colour as the background";
  return undefined;
}

function collectBlocks(): TextBlock[] {
  const blocks: TextBlock[] = [];
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const cache = new Map<Element, HiddenHow | undefined>();
  let count = 0;
  for (let node = walker.nextNode(); node && count < MAX_NODES; node = walker.nextNode(), count++) {
    const text = node.nodeValue?.trim() ?? "";
    if (text.length < 12) continue;
    if (node.nodeType === Node.COMMENT_NODE) {
      blocks.push({ text, hidden: "an HTML comment" });
      continue;
    }
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, noscript, template, edge-guard-ui")) continue;
    if (!cache.has(parent)) cache.set(parent, hiddenHow(parent));
    blocks.push({ text, hidden: cache.get(parent) });
  }
  return blocks;
}

async function scan(): Promise<void> {
  if (!alive() || !enabled) return;
  const { findings, candidates } = triage(collectBlocks());
  try {
    const report = await chrome.runtime.sendMessage<ToBackground, ScanReport | { error: string }>({ type: "scan", findings, candidates });
    if (!("error" in report)) showWarning(report);
  } catch {
    // The extension was reloaded; nothing to show.
  }
}

const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 500));
if (document.readyState === "complete") idle(() => void scan());
else window.addEventListener("load", () => idle(() => void scan()), { once: true });
