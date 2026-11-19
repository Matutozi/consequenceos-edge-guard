/**
 * Reads what a click landed on, for the content script: the control, its labels, and the
 * fields around it. Plain DOM code with no extension APIs, so it can be tested with jsdom.
 * It reads labels and form structure only, never what is typed into a field.
 */

export const CONTROLS =
  'button, a, input[type="submit"], input[type="button"], input[type="image"], [role="button"], [role="link"], [role="menuitem"]';

/** Opens a closed shadow root: chrome.dom.openOrClosedShadowRoot in a content script. */
export type ShadowOpener = (host: HTMLElement) => ShadowRoot | null | undefined;

const MAX_SHADOW_DEPTH = 8;

/**
 * The control a click landed on. A window listener sees the event retargeted to the outermost
 * shadow host, so event.target.closest() misses every button inside a web component. The
 * composed path reaches into open shadow roots. A closed root hides its inside even from the
 * path; for those, the control under the pointer is looked up inside the root, which a content
 * script can open. A synthetic click with no pointer position inside a closed root is not seen.
 */
export function findControl(event: Event, openShadow?: ShadowOpener): Element | undefined {
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && node.matches(CONTROLS)) return node;
  }
  const innermost = path[0];
  if (!openShadow || !(innermost instanceof HTMLElement) || !(event instanceof MouseEvent)) return undefined;
  if (event.clientX === 0 && event.clientY === 0) return undefined;

  let host: HTMLElement | null = innermost;
  for (let depth = 0; host && depth < MAX_SHADOW_DEPTH; depth++) {
    const root = openShadow(host);
    if (!root) return undefined;
    const under = root.elementFromPoint(event.clientX, event.clientY);
    if (!under || under === host) return undefined;
    const control = under.closest(CONTROLS);
    if (control) return control;
    host = under instanceof HTMLElement ? under : null;
  }
  return undefined;
}

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** Text of the elements an aria-labelledby names, looked up in the control's own tree. */
function labelledBy(el: Element): string {
  const ids = el.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  const root = el.getRootNode() as Document | ShadowRoot;
  return clean(ids.map((id) => root.getElementById?.(id)?.textContent ?? "").join(" "));
}

/**
 * Everything a control is labelled with. `label` is what a person sees: the text, or an
 * input's value or alt text. `otherLabels` is what assistive technology and agents read
 * (aria-label, aria-labelledby, title), which can say something else.
 */
export function labelsOf(el: Element): { label: string; otherLabels: string[] } {
  const input = el instanceof HTMLInputElement ? el : undefined;
  const visible = clean(input ? input.value || input.alt : (el as HTMLElement).innerText ?? el.textContent);
  const others = [clean(el.getAttribute("aria-label")), labelledBy(el), clean(el.getAttribute("title"))];
  const label = visible || others.find(Boolean) || "";
  return { label, otherLabels: [...new Set(others.filter((o) => o && o !== label))] };
}

export const isLink = (el: Element) => el instanceof HTMLAnchorElement || el.getAttribute("role") === "link";

const FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), select, textarea";
const MAX_LEVELS_UP = 6;

/**
 * The fields that belong with a control: its form, or, for the many apps without a <form>,
 * the nearest ancestor (a few levels up at most) that holds any field.
 */
export function fieldsAround(el: Element, form: HTMLFormElement | null): Element[] {
  if (form) return [...form.querySelectorAll(FIELDS)];
  let node = el.parentElement;
  for (let level = 0; node && level < MAX_LEVELS_UP; level++, node = node.parentElement) {
    const fields = node.querySelectorAll(FIELDS);
    if (fields.length > 0) return [...fields];
  }
  return [];
}

/**
 * Field names, ids, autocomplete tokens, placeholders and labels that mean a money transfer.
 * Read from the field's description, never its value.
 */
const MONEY_FIELD = /amount|\biban\b|\bswift\b|\bbic\b|routing|account.?(number|no\b|num)|sort.?code|payee|beneficiary|transfer|\bwire\b|cc-number|card.?number|\bcvc\b|\bcvv\b/i;

function describe(field: Element): string {
  const id = field.getAttribute("id");
  const root = field.getRootNode() as Document | ShadowRoot;
  const forLabel = id ? [...(root.querySelectorAll?.("label") ?? [])].find((label) => label.htmlFor === id)?.textContent : "";
  return [
    field.getAttribute("name"),
    id,
    field.getAttribute("autocomplete"),
    field.getAttribute("placeholder"),
    field.getAttribute("aria-label"),
    forLabel,
    field.closest("label")?.textContent,
  ].join(" ");
}

export const looksLikeMoney = (fields: Element[]) => fields.some((field) => MONEY_FIELD.test(describe(field)));

/**
 * What a form will send, taken when a click is paused and again just before it is replayed,
 * so a form changed while the person was deciding (another amount, another payee, another
 * address to send it to) is not sent on an approval given for the old one. Held in the
 * content script's memory for that comparison only; never stored, logged or sent.
 */
export interface FormState {
  /** Where the form sends its data, and how. */
  target: string;
  /** One entry per field: a key, a name a person can read, and what the field would send. */
  fields: { key: string; name: string; value: string }[];
}

function fieldValue(field: Element): string {
  if (field instanceof HTMLInputElement) {
    if (field.type === "checkbox" || field.type === "radio") return field.checked ? `checked:${field.value}` : "unchecked";
    if (field.type === "file") return [...(field.files ?? [])].map((f) => `${f.name}:${f.size}`).join("|");
    return field.value;
  }
  if (field instanceof HTMLSelectElement) return [...field.selectedOptions].map((o) => o.value).join("|");
  if (field instanceof HTMLTextAreaElement) return field.value;
  return "";
}

function readableName(field: Element): string {
  const id = field.getAttribute("id");
  const root = field.getRootNode() as Document | ShadowRoot;
  const forLabel = id ? [...(root.querySelectorAll?.("label") ?? [])].find((label) => label.htmlFor === id)?.textContent : "";
  return (
    clean(forLabel) ||
    clean(field.closest("label")?.textContent) ||
    clean(field.getAttribute("aria-label")) ||
    clean(field.getAttribute("placeholder")) ||
    field.getAttribute("name") ||
    id ||
    "a field"
  );
}

/** Every field, hidden ones included: a hidden "amount" or "to" field is still sent. */
const ALL_FIELDS = "input:not([type=submit]):not([type=button]):not([type=image]):not([type=reset]), select, textarea";

export function formState(control: Element | null, form: HTMLFormElement | null): FormState {
  const fields = form
    ? [...form.elements].filter((f) => f.matches(ALL_FIELDS))
    : control
      ? containerFields(control)
      : [];
  const seen = new Map<string, number>();
  return {
    // A submit button's formaction and formmethod override the form's own.
    target: form
      ? [form.method || "get", form.action, control?.getAttribute("formaction") ?? "", control?.getAttribute("formmethod") ?? ""].join(" ")
      : "no form",
    fields: fields.map((field) => {
      const base = `${field.tagName}:${field.getAttribute("name") ?? ""}:${field.getAttribute("id") ?? ""}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { key: `${base}#${n}`, name: readableName(field), value: fieldValue(field) };
    }),
  };
}

/** The fields of the nearest container with any field, hidden ones included, for apps with no <form>. */
function containerFields(control: Element): Element[] {
  let node = control.parentElement;
  for (let level = 0; node && level < MAX_LEVELS_UP; level++, node = node.parentElement) {
    if (node.querySelector(FIELDS)) return [...node.querySelectorAll(ALL_FIELDS)];
  }
  return [];
}

/**
 * What changed between two snapshots, in words: the readable names of the fields that were
 * changed, added or removed, and "where the form sends it" when its target changed.
 * Empty when nothing changed.
 */
export function changesBetween(before: FormState, after: FormState): string[] {
  const changes: string[] = [];
  if (before.target !== after.target) changes.push("where the form sends it");
  const old = new Map(before.fields.map((f) => [f.key, f]));
  const now = new Map(after.fields.map((f) => [f.key, f]));
  for (const [key, field] of now) {
    if (old.get(key)?.value !== field.value) changes.push(field.name);
  }
  for (const [key, field] of old) {
    if (!now.has(key)) changes.push(field.name);
  }
  return [...new Set(changes)];
}
