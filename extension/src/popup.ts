import { el, LANGUAGE_OPTIONS, promptApi, when } from "./dom";
import { ENABLED_KEY, HISTORY_KEY, scanKey, type HistoryItem, type ScanReport, type ToContent } from "./messages";

const $ = (id: string) => document.getElementById(id)!;

async function renderEnabled(): Promise<void> {
  const box = $("enabled") as HTMLInputElement;
  const { [ENABLED_KEY]: enabled } = await chrome.storage.local.get(ENABLED_KEY);
  box.checked = enabled !== false;
  $("enabled-label").textContent = box.checked ? "On" : "Off";
  box.addEventListener("change", async () => {
    await chrome.storage.local.set({ [ENABLED_KEY]: box.checked });
    $("enabled-label").textContent = box.checked ? "On" : "Off";
  });
}

async function renderAi(): Promise<void> {
  const box = $("ai");
  const api = promptApi();
  if (!api) {
    box.className = "box review";
    box.replaceChildren(
      el("p", { text: "This browser has no on-device AI." }),
      el("p", {
        className: "muted",
        text: "Edge Guard still pauses risky actions. Messages and deletions are checked in the cloud (only the button label and the site are sent); payments and sharing come straight to you.",
      }),
    );
    return;
  }
  const status = await api.availability(LANGUAGE_OPTIONS).catch(() => "unavailable");
  if (status === "available") {
    box.className = "box allow";
    box.replaceChildren(el("p", { text: "Gemini Nano is ready on this computer. Checks run here, privately." }));
    return;
  }
  if (status === "unavailable") {
    box.className = "box review";
    box.replaceChildren(el("p", { text: "This computer can't run Gemini Nano. Risky actions still pause and come to you." }));
    return;
  }
  const button = el("button", { className: "primary", text: status === "downloading" ? "Downloading…" : "Download Gemini Nano" });
  const progress = el("p", { className: "muted", text: "A one-time download, so checks can run privately on this computer." });
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Downloading…";
    try {
      // Chrome only starts the download from a click, so it happens here.
      const session = await api.create({
        ...LANGUAGE_OPTIONS,
        monitor(m: EventTarget) {
          m.addEventListener("downloadprogress", (e) => {
            progress.textContent = `Downloaded ${Math.round(((e as ProgressEvent).loaded ?? 0) * 100)}%`;
          });
        },
      });
      session.destroy();
      await renderAi();
    } catch (caught) {
      button.disabled = false;
      button.textContent = "Try again";
      progress.textContent = caught instanceof Error ? caught.message : "The download did not start.";
    }
  });
  box.className = "box";
  box.replaceChildren(el("p", { text: "Gemini Nano is not downloaded yet." }), progress, button);
}

async function renderPage(): Promise<void> {
  const box = $("page");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  const { [scanKey(tabId)]: report } = (await chrome.storage.session.get(scanKey(tabId))) as Record<string, ScanReport | undefined>;

  const again = el("button", { text: "Scan again" });
  again.addEventListener("click", async () => {
    again.disabled = true;
    again.textContent = "Scanning…";
    const message: ToContent = { type: "scan-now" };
    await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
    setTimeout(() => void renderPage(), 1500);
  });

  if (!report) {
    again.textContent = "Scan this page";
    box.className = "box";
    box.replaceChildren(el("p", { text: "This page has not been scanned. Edge Guard scans ordinary web pages as they load." }), again);
    return;
  }
  const n = report.findings.length;
  const aiNote: Record<ScanReport["aiCheck"], string> = {
    done: `Gemini Nano also checked ${report.checked} suspicious passage${report.checked === 1 ? "" : "s"} on this computer.`,
    "not-needed": "Nothing on the page needed an AI check.",
    "no-model": `${report.checked} passage${report.checked === 1 ? "" : "s"} could not get an AI check: Gemini Nano is not ready.`,
    failed: "The on-device AI check did not finish.",
  };
  box.className = n ? "box deny" : "box allow";
  const items = report.findings.map((f) =>
    el("li", {}, el("q", { text: f.text.length > 160 ? `${f.text.slice(0, 159)}…` : f.text }), el("div", { className: "muted", text: f.why })),
  );
  box.replaceChildren(
    el("p", {
      text: n
        ? `Found ${n === 1 ? "a hidden instruction" : `${n} hidden instructions`} aimed at AI agents. Don't let an AI act here unsupervised.`
        : "No hidden instructions aimed at AI found.",
    }),
    ...(items.length ? [el("ul", { className: "list" }, ...items)] : []),
    el("p", { className: "muted", text: `${aiNote[report.aiCheck]} Scanned at ${when(report.at)}.` }),
    again,
  );
}

async function renderHistory(): Promise<void> {
  const list = $("history");
  const { [HISTORY_KEY]: history = [] } = (await chrome.storage.local.get(HISTORY_KEY)) as { [HISTORY_KEY]?: HistoryItem[] };
  if (history.length === 0) {
    list.replaceChildren(el("li", { className: "muted", text: "Nothing yet. Try paying, sending or deleting something on a site." }));
    return;
  }
  list.replaceChildren(
    ...history.slice(0, 8).map((h) =>
      el(
        "li",
        {},
        el("div", { className: "row" }, el("strong", { text: `“${h.label}” on ${h.site}` }), el("span", { className: `tag ${h.outcome}`, text: h.outcome === "allowed" ? "Allowed" : "Blocked" })),
        el("div", { text: h.explanation }),
        el("div", { className: "muted", text: `Decided by ${h.by}, ${when(h.at)}.` }),
      ),
    ),
  );
}

void renderEnabled();
void renderAi();
void renderPage();
void renderHistory();
