// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardResponse, ToBackground, ToContent } from "./messages";

/**
 * The real content script, in jsdom, with a stand-in for the extension APIs: what happens to a
 * paused click when the person allows it, and when the page changed while they were deciding.
 */
type Listener = (message: ToContent) => void;
const sent: ToBackground[] = [];
let onMessage: Listener | undefined;
let answer: (message: ToBackground) => Promise<unknown>;

const result: GuardResponse["result"] = {
  decision: "require_approval",
  explanation: "Payments always need your OK.",
  decidedBy: "a fixed rule",
  digest: "d".repeat(64),
  receiptId: "r1",
};
const pending = (id: string): GuardResponse => ({ status: "pending", id, result });

beforeAll(async () => {
  // jsdom has no layout: let the hidden-text scan run without finding anything.
  Element.prototype.checkVisibility = () => true;
  vi.stubGlobal("chrome", {
    runtime: {
      id: "edge-guard-test",
      sendMessage: (message: ToBackground) => {
        sent.push(message);
        return message.type === "guard-action" ? answer(message) : Promise.resolve({ error: "not in this test" });
      },
      onMessage: { addListener: (listener: Listener) => (onMessage = listener) },
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => undefined } },
    dom: { openOrClosedShadowRoot: () => null },
  });
  await import("./content");
});

beforeEach(() => {
  sent.length = 0;
  answer = async () => pending("p1");
});

/** A transfer form whose page code counts what it receives, and never navigates. */
function transferPage() {
  document.body.innerHTML = `
    <form action="https://bank.example/transfer" method="post">
      <label for="amt">Amount</label><input id="amt" name="amount" value="100">
      <input name="iban" placeholder="IBAN" value="DE89 3704 0044 0532 0130 00">
      <button id="go">Confirm</button>
    </form>`;
  const counts = { clicks: 0, submits: 0 };
  const button = document.getElementById("go") as HTMLButtonElement;
  button.addEventListener("click", () => counts.clicks++);
  button.form!.addEventListener("submit", (event) => {
    event.preventDefault();
    counts.submits++;
  });
  return { button, amount: document.getElementById("amt") as HTMLInputElement, counts };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const decide = (id: string, allow: boolean) => onMessage!({ type: "decision", id, allow });
const guardCalls = () => sent.filter((m) => m.type === "guard-action").length;

describe("a paused click", () => {
  it("pauses a Confirm on a transfer form and sends it once when allowed", async () => {
    const { button, counts } = transferPage();
    button.click();
    await flush();
    expect(guardCalls()).toBe(1);
    expect(counts).toEqual({ clicks: 0, submits: 0 });
    decide("p1", true);
    expect(counts).toEqual({ clicks: 1, submits: 1 });
  });

  it("does not send a form that changed while the person was deciding, and says what changed", async () => {
    const { button, amount, counts } = transferPage();
    button.click();
    await flush();
    amount.value = "9000";
    decide("p1", true);
    expect(counts).toEqual({ clicks: 0, submits: 0 });
    const record = sent.find((m) => m.type === "record");
    expect(record).toMatchObject({ type: "record", item: { outcome: "blocked", digest: result.digest } });
    expect(record?.type === "record" && record.item.explanation).toMatch(/“Amount” changed while you were deciding/);
  });

  it("does not send a form that changed while the check was running, before any approval", async () => {
    const { button, amount, counts } = transferPage();
    let allow!: () => void;
    answer = () => new Promise((resolve) => (allow = () => resolve({ status: "allow", result: { ...result, decision: "allow" } })));
    button.click();
    await flush();
    amount.value = "9000";
    allow();
    await flush();
    expect(counts).toEqual({ clicks: 0, submits: 0 });
    expect(sent.some((m) => m.type === "record" && m.item.outcome === "blocked")).toBe(true);
  });

  it("does not send a click whose button the page removed", async () => {
    const { button, counts } = transferPage();
    button.click();
    await flush();
    button.remove();
    decide("p1", true);
    expect(counts.clicks).toBe(0);
  });

  it("leaves no allowance behind when the replayed click did not submit: the next submission is checked", async () => {
    // A payment form whose own code stops the first click (say, a validation message). The old
    // replay left the form marked as allowed, so pressing Enter later went through unchecked.
    document.body.innerHTML = `
      <form><input autocomplete="cc-number" name="card"><button id="pay">Pay</button></form>`;
    const button = document.getElementById("pay") as HTMLButtonElement;
    const form = button.form!;
    let submits = 0;
    let stopFirstClick = true;
    button.addEventListener("click", (event) => {
      if (stopFirstClick) event.preventDefault();
      stopFirstClick = false;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submits++;
    });
    button.click();
    await flush();
    decide("p1", true);
    expect(submits).toBe(0);
    answer = async () => pending("p2");
    form.requestSubmit();
    await flush();
    expect(guardCalls()).toBe(2);
    expect(submits).toBe(0);
  });

  it("leaves a blocked click unsent", async () => {
    const { button, counts } = transferPage();
    button.click();
    await flush();
    decide("p1", false);
    expect(counts).toEqual({ clicks: 0, submits: 0 });
  });
});
