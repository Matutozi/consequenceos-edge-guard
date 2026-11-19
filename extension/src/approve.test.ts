// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pending } from "./messages";
import { automationWarning } from "./trust";

/**
 * The approval window, rendered by the real approve.ts in jsdom. Found in the audit: the window
 * was described as one no agent could press. An agent that drives the whole browser can, and
 * when Chrome says it is under automation the window must say so.
 */
const pending: Pending = {
  id: "p1",
  tabId: 1,
  frameId: 0,
  action: {
    label: "Pay $1,240.00",
    category: "payment",
    words: "a payment",
    sensitivity: "confidential",
    reversible: false,
    page: { host: "travel.example", title: "Checkout" },
  },
  result: { decision: "require_approval", explanation: "Payments always need your OK.", decidedBy: "a fixed rule", digest: "d".repeat(64), receiptId: "r1" },
};

async function render(webdriver: boolean) {
  vi.resetModules();
  document.body.innerHTML = `<main id="main"></main>`;
  window.history.replaceState(null, "", "/approve.html?id=p1");
  Object.defineProperty(navigator, "webdriver", { value: webdriver, configurable: true });
  vi.stubGlobal("chrome", {
    storage: { session: { get: async () => ({ "pending:p1": pending }), remove: async () => undefined } },
    tabs: { sendMessage: async () => undefined },
    runtime: { sendMessage: async () => undefined },
  });
  await import("./approve");
  await vi.waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
  return document.getElementById("main")!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the approval window", () => {
  it("says so when the browser is run by automation, which can press its buttons", async () => {
    const main = await render(true);
    const alert = main.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/run by automation software/);
    expect(alert?.textContent).toMatch(/may not have come from you/);
    // Block still has focus, so a stray Enter blocks.
    expect(document.activeElement?.textContent).toBe("Block");
  });

  it("shows no automation warning in an ordinary browser", async () => {
    const main = await render(false);
    expect(main.querySelector('[role="alert"]')).toBeNull();
    expect(main.textContent).toMatch(/Is this what you want\?/);
  });

  it("words the warning without promising what it cannot", () => {
    expect(automationWarning({})).toBeUndefined();
    expect(automationWarning({ webdriver: true })).not.toMatch(/cannot|can't/);
  });
});
