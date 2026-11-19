import { guardPageAction } from "./guard";
import {
  ENABLED_KEY,
  HISTORY_KEY,
  MAX_HISTORY,
  pendingKey,
  scanKey,
  type GuardResponse,
  type HistoryItem,
  type PageAction,
  type Pending,
  type ScanReport,
  type ToBackground,
  type ToContent,
} from "./messages";
import { judgeOnDevice } from "./scan";

/**
 * The service worker: runs Edge Guard on actions the content script stopped, opens the
 * approval window, keeps the history and the per-tab scan results. It holds no state in
 * variables (Chrome stops idle workers); everything lives in chrome.storage.
 */

chrome.runtime.onInstalled.addListener(async () => {
  const { [ENABLED_KEY]: enabled } = await chrome.storage.local.get(ENABLED_KEY);
  if (enabled === undefined) await chrome.storage.local.set({ [ENABLED_KEY]: true });
});

async function record(item: HistoryItem): Promise<void> {
  const { [HISTORY_KEY]: history = [] } = (await chrome.storage.local.get(HISTORY_KEY)) as { [HISTORY_KEY]?: HistoryItem[] };
  await chrome.storage.local.set({ [HISTORY_KEY]: [item, ...history].slice(0, MAX_HISTORY) });
}

const historyItem = (action: PageAction, outcome: HistoryItem["outcome"], by: string, explanation: string, digest: string): HistoryItem => ({
  at: new Date().toISOString(),
  site: action.page.host,
  label: action.label,
  words: action.words,
  outcome,
  by,
  explanation,
  digest,
});

/**
 * The approval lives in its own window, outside the page. A page, or an agent driving the
 * page, can click anything inside the page, including an "Allow" button drawn there; it
 * cannot reach this window.
 */
async function askPerson(tabId: number, action: PageAction, result: GuardResponse["result"]): Promise<GuardResponse> {
  const id = crypto.randomUUID();
  const pending: Pending = { id, tabId, action, result };
  await chrome.storage.session.set({ [pendingKey(id)]: pending });
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL(`approve.html?id=${id}`),
    type: "popup",
    width: 440,
    height: 560,
    focused: true,
  });
  await chrome.storage.session.set({ [pendingKey(id)]: { ...pending, windowId: window?.id } });
  return { status: "pending", id, result };
}

async function handleAction(tabId: number, action: PageAction): Promise<GuardResponse> {
  const result = await guardPageAction(action);
  if (result.decision === "allow") {
    await record(historyItem(action, "allowed", result.decidedBy, result.explanation, result.digest));
    return { status: "allow", result };
  }
  return askPerson(tabId, action, result);
}

async function handleScan(tabId: number, message: Extract<ToBackground, { type: "scan" }>): Promise<ScanReport> {
  const judged = await judgeOnDevice(message.candidates);
  const report: ScanReport = {
    at: new Date().toISOString(),
    findings: [...message.findings, ...judged.findings],
    aiCheck: judged.aiCheck,
    checked: message.candidates.length,
  };
  await chrome.storage.session.set({ [scanKey(tabId)]: report });
  const count = report.findings.length;
  await chrome.action.setBadgeText({ tabId, text: count ? "!" : "" });
  if (count) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b91c1c" });
  await chrome.action.setTitle({
    tabId,
    title: count ? `Edge Guard: ${count} hidden instruction${count === 1 ? "" : "s"} aimed at AI on this page` : "Edge Guard",
  });
  return report;
}

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  (async () => {
    try {
      if (message.type === "record") {
        await record(message.item);
        sendResponse({ ok: true });
      } else if (tabId === undefined) {
        sendResponse({ error: "Edge Guard only acts on messages from a page." });
      } else if (message.type === "guard-action") {
        sendResponse(await handleAction(tabId, message.action));
      } else if (message.type === "scan") {
        sendResponse(await handleScan(tabId, message));
      }
    } catch (caught) {
      sendResponse({ error: caught instanceof Error ? caught.message : String(caught) });
    }
  })();
  return true;
});

/** Closing the approval window without answering blocks the action. */
chrome.windows.onRemoved.addListener(async (windowId) => {
  const all = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(all)) {
    const pending = value as Pending;
    if (!key.startsWith("pending:") || pending.windowId !== windowId) continue;
    await chrome.storage.session.remove(key);
    const decision: ToContent = { type: "decision", id: pending.id, allow: false };
    await chrome.tabs.sendMessage(pending.tabId, decision).catch(() => undefined);
    await record(
      historyItem(pending.action, "blocked", "you (the window was closed without an answer)", pending.result.explanation, pending.result.digest),
    );
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(scanKey(tabId));
});
