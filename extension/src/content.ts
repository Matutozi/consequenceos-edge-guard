import { classifyAction, type ActionSignals } from "./classify";
import { contrast, triage, type HiddenHow, type TextBlock } from "./injection";
import {
  ENABLED_KEY,
  type GuardResponse,
  type PageAction,
  type ScanReport,
  type ToastKind,
  type ToBackground,
  type ToContent,
} from "./messages";
import { changesBetween, fieldsAround, findControl, formState, isLink, labelsOf, looksLikeMoney } from "./target";

/**
 * Runs in every page and every frame in it (a checkout or a share dialog is often an
 * embedded frame). Stops consequential clicks and submissions until Edge Guard has decided,
 * replays them when allowed, and, in the top page, gathers hidden text for the scanner.
 * It reads labels and form structure only, never what is typed into a form.
 */

const isTop = window === window.top;

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

const CARD_FIELDS =
  'input[autocomplete~="cc-number"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="ccnum" i], input[id*="cardnumber" i], input[id*="card-number" i]';

/**
 * Sends a paused click or submission once it is allowed. Returns why it was not sent, or
 * undefined when it was: the page may have changed while the person was deciding.
 */
type Replay = () => string | undefined;
const pendingReplays = new Map<string, { replay: Replay; action: PageAction; result: GuardResponse["result"] }>();

/**
 * The click or submission being replayed right now. Set only while the replay runs: a click
 * fires its submit event synchronously, so both are let through, and nothing is left over to
 * let a later click or Enter through unchecked.
 */
let replaying: { control?: Element; form?: HTMLFormElement } | undefined;

function replayNow(run: () => void, control?: Element, form?: HTMLFormElement | null): void {
  replaying = { control, form: form ?? undefined };
  try {
    run();
  } finally {
    replaying = undefined;
  }
}

const quoted = (names: string[]) => {
  const shown = names.slice(0, 3).map((n) => `“${n.length > 40 ? `${n.slice(0, 39)}…` : n}”`);
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return shown.length === 1 ? `${shown[0]}${more}` : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}${more}`;
};

/**
 * The check before a replay: the form must still send what it would have sent when it was
 * paused. An approval is for that, not for whatever the page or an agent typed in meanwhile.
 */
function unchangedSince(before: ReturnType<typeof formState>, control: Element | null, form: HTMLFormElement | null): string | undefined {
  if ((control && !control.isConnected) || (form && !form.isConnected)) {
    return "the page changed while you were deciding, and the button is gone. Check the page and try again.";
  }
  const changed = changesBetween(before, formState(control, form));
  return changed.length > 0
    ? `${quoted(changed)} changed while you were deciding. Check the form and try again.`
    : undefined;
}

const MAX_SHOWN_LABEL = 120;
const shorten = (text: string) => (text.length > MAX_SHOWN_LABEL ? `${text.slice(0, MAX_SHOWN_LABEL - 1)}…` : text);

/** The site whose page embeds this frame, when it is another site. */
function embeddingSite(): string | undefined {
  if (isTop) return undefined;
  const origins = location.ancestorOrigins;
  const top = origins && origins.length > 0 ? origins[origins.length - 1] : undefined;
  try {
    const host = top && top !== "null" ? new URL(top).host : undefined;
    return host && host !== location.host ? host : undefined;
  } catch {
    return undefined;
  }
}

function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return el.type === "submit";
  return el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image");
}

function signalsFor(el: Element | null, form: HTMLFormElement | null, control: Element | null): ActionSignals {
  const submits = !el || isSubmitControl(el);
  const { label, otherLabels } = control ? labelsOf(control) : { label: "", otherLabels: [] };
  let formActionHost: string | undefined;
  try {
    // A submit button's formaction overrides the form's action.
    const override = control?.getAttribute("formaction");
    formActionHost = override
      ? new URL(override, location.href).host
      : form?.getAttribute("action")
        ? new URL(form.action).host
        : undefined;
  } catch {
    formActionHost = undefined;
  }
  return {
    label,
    otherLabels,
    isLink: !!control && isLink(control),
    moneyFields: looksLikeMoney(control ? fieldsAround(control, form) : form ? fieldsAround(form, form) : []),
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
  // When only a hidden label (aria-label, title) made it consequential, say so: the person sees
  // "Continue", but the control told an agent "Pay now".
  const visibleOnly = classifyAction({ ...signals, otherLabels: [] });
  const shown = signals.label || "Submit";
  const label =
    visibleOnly?.category === classified.category || !signals.otherLabels?.length
      ? shown
      : `${shown} (labelled “${signals.otherLabels.join("”, “")}” for screen readers and agents)`;
  return {
    label: shorten(label),
    category: classified.category,
    words: classified.words,
    sensitivity: classified.sensitivity as PageAction["sensitivity"],
    reversible: classified.reversible,
    blockedBecause: classified.blockedBecause,
    page: { host: location.host, title: document.title, ...(embeddingSite() && { embeddedIn: embeddingSite() }) },
  };
}

/** Sends an allowed action, or says why it was not sent and records that in the history. */
function send(replay: Replay, action: PageAction, result: GuardResponse["result"], allowedText: string): void {
  const notSent = replay();
  if (!notSent) {
    toast("allowed", allowedText);
    return;
  }
  toast("blocked", `Not sent: ${notSent}`);
  const record: ToBackground = {
    type: "record",
    item: {
      at: new Date().toISOString(),
      site: action.page.host,
      label: action.label,
      words: action.words,
      outcome: "blocked",
      by: "Edge Guard, after it was allowed: the page changed before it was sent",
      explanation: notSent,
      digest: result.digest,
    },
  };
  chrome.runtime.sendMessage(record).catch(() => undefined);
}

async function check(action: PageAction, replay: Replay): Promise<void> {
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
    // The check took a moment, a model's answer several seconds: the form is compared here too.
    send(replay, action, response.result, `Allowed. ${response.result.explanation}`);
    return;
  }
  pendingReplays.set(response.id, { replay, action, result: response.result });
  toast(
    response.result.decision === "deny" ? "blocked" : "waiting",
    response.result.decision === "deny"
      ? "Blocked. See the Edge Guard window for why, and to override it."
      : "Waiting for your answer in the Edge Guard window.",
  );
}

function onClick(event: MouseEvent): void {
  if (!enabled || !alive()) return;
  // Through shadow roots too: open ones by the composed path, closed ones by asking Chrome.
  const el = findControl(event, (host) => chrome.dom?.openOrClosedShadowRoot(host));
  if (!el || replaying?.control === el) return;
  const form = (el as HTMLButtonElement).form ?? el.closest("form");
  const action = pageAction(signalsFor(el, form, el));
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const before = formState(el, form);
  void check(action, () => {
    const notSent = unchangedSince(before, el, form);
    if (notSent) return notSent;
    replayNow(() => (el as HTMLElement).click(), el, form && isSubmitControl(el) ? form : null);
    return undefined;
  });
}

/** Submissions without a click (pressing Enter), on forms with card or password fields. */
function onSubmit(event: SubmitEvent): void {
  if (!enabled || !alive()) return;
  const form = event.target as HTMLFormElement;
  if (replaying?.form === form) return;
  const submitter = event.submitter;
  const action = pageAction(signalsFor(null, form, submitter));
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const before = formState(submitter, form);
  void check(action, () => {
    const notSent = unchangedSince(before, submitter, form);
    if (notSent) return notSent;
    if (submitter && (submitter as HTMLButtonElement | HTMLInputElement).form !== form) return "the button moved out of the form while you were deciding. Try again.";
    replayNow(() => form.requestSubmit(submitter ?? undefined), undefined, form);
    return undefined;
  });
}

window.addEventListener("click", onClick, true);
window.addEventListener("submit", onSubmit, true);

chrome.runtime.onMessage.addListener((message: ToContent) => {
  if (message.type === "decision") {
    const pending = pendingReplays.get(message.id);
    pendingReplays.delete(message.id);
    if (!pending) return;
    if (message.allow) {
      send(pending.replay, pending.action, pending.result, "You allowed it.");
    } else {
      toast("blocked", "Blocked. Nothing was sent.");
    }
  } else if (message.type === "scan-now") {
    void scan();
  } else if (message.type === "toast" && isTop) {
    showToast(message.kind, message.text);
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

/**
 * Shows a status card. A frame can be a few pixels tall, so a frame asks the top page to show
 * it instead, through the service worker.
 */
function toast(kind: ToastKind, text: string): void {
  if (isTop) {
    showToast(kind, text);
    return;
  }
  const message: ToBackground = { type: "toast", kind, text };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function showToast(kind: ToastKind, text: string): void {
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

/** The top page only: its report and badge are per tab, and frames would overwrite each other's. */
async function scan(): Promise<void> {
  if (!isTop || !alive() || !enabled) return;
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
