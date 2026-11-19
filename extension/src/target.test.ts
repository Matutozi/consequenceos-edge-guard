// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { classifyAction } from "./classify";
import { changesBetween, CONTROLS, fieldsAround, findControl, formState, isLink, labelsOf, looksLikeMoney } from "./target";

afterEach(() => {
  document.body.replaceChildren();
});

/** Dispatches a click from `from` and returns what a window capture listener would find. */
function clickAt(from: Element, init: MouseEventInit = {}, openShadow?: Parameters<typeof findControl>[1]) {
  let found: Element | undefined;
  let retargeted: Element | null = null;
  const listener = (event: Event) => {
    found = findControl(event, openShadow);
    retargeted = (event.target as Element).closest(CONTROLS);
  };
  window.addEventListener("click", listener, true);
  from.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, ...init }));
  window.removeEventListener("click", listener, true);
  return { found, retargeted };
}

function component(mode: ShadowRootMode, inner: string) {
  const host = document.createElement("pay-widget");
  document.body.append(host);
  const root = host.attachShadow({ mode });
  root.innerHTML = inner;
  return { host, root };
}

describe("findControl", () => {
  it("finds a plain button from a click on its icon", () => {
    document.body.innerHTML = `<button id="b"><span id="icon">★</span> Pay now</button>`;
    expect(clickAt(document.getElementById("icon")!).found?.id).toBe("b");
  });

  it("finds a button inside an open shadow root, which closest() on the target missed", () => {
    const { root } = component("open", `<button id="pay"><span>Pay $40</span></button>`);
    const { found, retargeted } = clickAt(root.querySelector("span")!);
    expect(retargeted).toBeNull(); // the old lookup: the event is retargeted to <pay-widget>
    expect(found?.id).toBe("pay");
  });

  it("finds a button in a closed shadow root at the pointer, when the content script can open it", () => {
    const { host, root } = component("closed", `<div><button id="pay">Pay $40</button></div>`);
    const button = root.querySelector("button")!;
    const opener = (el: HTMLElement) =>
      el === host ? ({ elementFromPoint: () => button } as unknown as ShadowRoot) : null;
    expect(clickAt(button, { clientX: 40, clientY: 20 }).found).toBeUndefined(); // no way in without the opener
    expect(clickAt(button, { clientX: 40, clientY: 20 }, opener).found).toBe(button);
  });

  it("finds a button in a closed root nested in another closed root", () => {
    const { host, root } = component("closed", `<inner-widget></inner-widget>`);
    const innerHost = root.querySelector("inner-widget") as HTMLElement;
    const innerRoot = innerHost.attachShadow({ mode: "closed" });
    innerRoot.innerHTML = `<button id="del">Delete account</button>`;
    const button = innerRoot.querySelector("button")!;
    const opener = (el: HTMLElement) =>
      el === host
        ? ({ elementFromPoint: () => innerHost } as unknown as ShadowRoot)
        : el === innerHost
          ? ({ elementFromPoint: () => button } as unknown as ShadowRoot)
          : null;
    expect(clickAt(button, { clientX: 5, clientY: 5 }, opener).found).toBe(button);
  });

  it("cannot see into a closed root without a pointer position, and says nothing", () => {
    const { host, root } = component("closed", `<button>Pay $40</button>`);
    const opener = (el: HTMLElement) => (el === host ? ({ elementFromPoint: () => root.querySelector("button") } as unknown as ShadowRoot) : null);
    expect(clickAt(root.querySelector("button")!, {}, opener).found).toBeUndefined();
  });

  it("ignores clicks on things that are not controls", () => {
    document.body.innerHTML = `<p id="p">Some text</p>`;
    expect(clickAt(document.getElementById("p")!).found).toBeUndefined();
  });
});

describe("labelsOf", () => {
  it("separates what a person sees from what an agent reads", () => {
    document.body.innerHTML = `<button aria-label="Pay now" title="Pay now">Continue</button>`;
    expect(labelsOf(document.querySelector("button")!)).toEqual({ label: "Continue", otherLabels: ["Pay now"] });
  });

  it("reads aria-labelledby inside the control's own tree", () => {
    document.body.innerHTML = `<span id="l1">Delete</span><span id="l2">workspace</span><button aria-labelledby="l1 l2">→</button>`;
    expect(labelsOf(document.querySelector("button")!)).toEqual({ label: "→", otherLabels: ["Delete workspace"] });
  });

  it("uses the hidden label when nothing is visible, and an input's value", () => {
    document.body.innerHTML = `<button aria-label="Share"><svg></svg></button><input type="submit" value="Place order">`;
    expect(labelsOf(document.querySelector("button")!)).toEqual({ label: "Share", otherLabels: [] });
    expect(labelsOf(document.querySelector("input")!).label).toBe("Place order");
  });

  it("tells links from buttons", () => {
    document.body.innerHTML = `<a href="#">x</a><span role="link">y</span><button>z</button>`;
    expect([...document.body.children].map(isLink)).toEqual([true, true, false]);
  });
});

describe("fieldsAround and looksLikeMoney", () => {
  it("recognises a transfer form by its fields' names and labels, not their values", () => {
    document.body.innerHTML = `
      <form><label for="amt">Amount to send</label><input id="amt"><input name="iban"><button>Confirm</button></form>`;
    const button = document.querySelector("button")!;
    expect(looksLikeMoney(fieldsAround(button, button.form))).toBe(true);
  });

  it("finds the fields of an app with no <form>, a few levels up", () => {
    document.body.innerHTML = `
      <div class="panel"><div class="row"><input placeholder="Beneficiary"></div>
        <div class="actions"><div><button>Continue</button></div></div></div>`;
    const button = document.querySelector("button")!;
    expect(fieldsAround(button, null)).toHaveLength(1);
    expect(looksLikeMoney(fieldsAround(button, null))).toBe(true);
  });

  it("does not take an email form or a search box for money, whatever was typed", () => {
    document.body.innerHTML = `
      <form><input name="to"><input name="subject"><textarea name="body"></textarea><button>Continue</button></form>
      <form><input name="q" value="IBAN amount transfer"><button>Search</button></form>`;
    const [email, search] = [...document.querySelectorAll("button")];
    expect(looksLikeMoney(fieldsAround(email, email.form))).toBe(false);
    expect(looksLikeMoney(fieldsAround(search, search.form))).toBe(false);
  });

  it("ends to end: a generic Continue over an amount and an account number is a payment", () => {
    document.body.innerHTML = `
      <section><input autocomplete="transaction-amount" name="amount"><input name="account_number">
        <button aria-label="Continue">Continue</button></section>`;
    const button = document.querySelector("button")!;
    const { label, otherLabels } = labelsOf(button);
    const signals = { label, otherLabels, moneyFields: looksLikeMoney(fieldsAround(button, null)), pageHost: "bank.example" };
    expect(classifyAction(signals)?.category).toBe("payment");
    expect(classifyAction({ ...signals, moneyFields: false })).toBeUndefined();
  });
});

describe("formState and changesBetween", () => {
  const transfer = () => {
    document.body.innerHTML = `
      <form action="https://bank.example/transfer" method="post">
        <label for="amt">Amount</label><input id="amt" name="amount" value="100">
        <input name="iban" placeholder="IBAN" value="DE89 3704 0044 0532 0130 00">
        <input type="hidden" name="to" value="savings">
        <select name="speed"><option value="normal" selected>Normal</option><option value="instant">Instant</option></select>
        <label><input type="checkbox" name="save" value="yes"> Save payee</label>
        <button id="go">Confirm</button>
      </form>`;
    const button = document.getElementById("go") as HTMLButtonElement;
    return { button, form: button.form!, state: () => formState(button, button.form) };
  };

  it("finds nothing when nothing changed", () => {
    const { state } = transfer();
    expect(changesBetween(state(), state())).toEqual([]);
  });

  it("names each changed field the way a person would read it", () => {
    const { state, form } = transfer();
    const before = state();
    (form.elements.namedItem("amount") as HTMLInputElement).value = "9000";
    (form.elements.namedItem("iban") as HTMLInputElement).value = "GB33 BUKB 2020 1555 5555 55";
    (form.elements.namedItem("speed") as HTMLSelectElement).value = "instant";
    (form.elements.namedItem("save") as HTMLInputElement).checked = true;
    expect(changesBetween(before, state())).toEqual(["Amount", "IBAN", "speed", "Save payee"]);
  });

  it("catches a hidden field and a new field, which a person cannot see change", () => {
    const { state, form } = transfer();
    const before = state();
    (form.elements.namedItem("to") as HTMLInputElement).value = "attacker";
    const extra = document.createElement("input");
    extra.name = "cc";
    form.append(extra);
    expect(changesBetween(before, state())).toEqual(["to", "cc"]);
  });

  it("catches a change to where the form sends it, including a button's formaction", () => {
    const { state, form, button } = transfer();
    const before = state();
    form.action = "https://evil.example/collect";
    expect(changesBetween(before, state())).toEqual(["where the form sends it"]);
    form.action = "https://bank.example/transfer";
    button.setAttribute("formaction", "https://evil.example/collect");
    expect(changesBetween(before, state())).toEqual(["where the form sends it"]);
  });

  it("covers apps with no <form>, by the fields around the button", () => {
    document.body.innerHTML = `<div><input aria-label="Amount" value="5"><div><button>Send money</button></div></div>`;
    const button = document.querySelector("button")!;
    const before = formState(button, null);
    document.querySelector("input")!.value = "5000";
    expect(changesBetween(before, formState(button, null))).toEqual(["Amount"]);
  });
});
