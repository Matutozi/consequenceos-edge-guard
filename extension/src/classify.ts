import type { DataSensitivity } from "../../src/domain/types";

/**
 * What a click or form submission on a web page would do, decided by rule from what the
 * page shows: the button's label and the fields in its form. No model, no page content.
 * Most clicks are none of these and pass untouched.
 */
export type ActionCategory = "credentials" | "payment" | "delete" | "share" | "send";

export interface ActionSignals {
  /** The visible label of the button or link: its text, or an input's value. */
  label: string;
  /**
   * Its other labels: aria-label, aria-labelledby, title. An agent reads these, and a page can
   * make them say something else than the visible text ("Continue" labelled "Pay now"), so
   * every label is classified, not just the visible one.
   */
  otherLabels?: string[];
  /** It is a link (an <a> or role="link"), whose long text is usually content, not a command. */
  isLink?: boolean;
  /**
   * The fields around it (its form, or the nearest container with fields) look like a money
   * transfer: amount, IBAN, account number, payee. Read from field names and labels, never values.
   */
  moneyFields?: boolean;
  /** The form around it has a card-number field. */
  formHasCardField?: boolean;
  /** The form around it has a password field with something typed in it. */
  formHasPassword?: boolean;
  /** Where the form sends its data, when it has an action URL. */
  formActionHost?: string;
  /** The site the page is on. */
  pageHost: string;
}

export interface ClassifiedAction {
  category: ActionCategory;
  /** The category in plain words, for people: "a payment". */
  words: string;
  sensitivity: DataSensitivity;
  reversible: boolean;
  /** Set when a rule alone decides to block, before any model. */
  blockedBecause?: string;
}

/**
 * A label longer than this is read by its first few words only: the command comes first
 * ("Pay $1,240 to Acme Travel for booking 88812..."). A long link is content and is skipped.
 */
export const MAX_LABEL = 60;
const LEADING_WORDS = 4;

/**
 * Generic commands that only mean money when the fields around them do: "Confirm" under an
 * amount and an IBAN is a transfer. Matched at the start of the label.
 */
const GENERIC_CONFIRM =
  /^(confirm|continue|submit|approve|authori[sz]e|proceed|complete|finish|done|ok|yes|next|review\s+and\s+\w+|send)\b/i;

const PATTERNS: [Exclude<ActionCategory, "credentials">, RegExp][] = [
  [
    "payment",
    /\b(pay(\s+now)?|buy(\s+now)?|purchase|place\s+(your\s+)?order|complete\s+(purchase|order|payment)|check\s*out|confirm\s+(payment|purchase|order)|transfer|send\s+money|donate|subscribe)\b/i,
  ],
  [
    "delete",
    /\b(delete|remove|erase|discard|empty\s+(trash|bin)|close\s+(my\s+)?account|deactivate|cancel\s+(my\s+)?(subscription|account))\b/i,
  ],
  [
    "share",
    /\b(share|make\s+public|invite|grant\s+access|add\s+(a\s+)?(member|collaborator|people)|change\s+(permissions|access)|anyone\s+with\s+the\s+link)\b/i,
  ],
  ["send", /\b(send|reply(\s+all)?|forward|post|publish|tweet|comment)\b/i],
];

/** Noun phrases that read right in "Edge Guard paused …" and "checking …". */
const WORDS: Record<ActionCategory, string> = {
  credentials: "your password being sent",
  payment: "a payment",
  delete: "a deletion",
  share: "a change to who can see or edit something",
  send: "a message being sent or published",
};

/**
 * Data class and reversibility per category, chosen so the shared policy does the right
 * thing: a payment or a sharing change always needs a person (confidential data), while a
 * message or a deletion that the AI rates low risk may go ahead.
 */
const PROPERTIES: Record<ActionCategory, { sensitivity: DataSensitivity; reversible: boolean }> = {
  credentials: { sensitivity: "confidential", reversible: false },
  payment: { sensitivity: "confidential", reversible: false },
  share: { sensitivity: "confidential", reversible: true },
  delete: { sensitivity: "internal", reversible: false },
  send: { sensitivity: "internal", reversible: false },
};

/**
 * Suffixes under which anyone can register a name, so "bank.co.uk" and "evil.co.uk" are
 * different sites. Not the full Public Suffix List: the common two-part country suffixes (by
 * rule, below) and hosting platforms where each customer gets a subdomain. A host this misses
 * counts as one site with its neighbours, so a password to a neighbour is not blocked by this rule.
 */
const SHARED_SUFFIXES = new Set([
  "github.io", "gitlab.io", "web.app", "firebaseapp.com", "appspot.com", "pages.dev", "workers.dev",
  "vercel.app", "netlify.app", "herokuapp.com", "onrender.com", "fly.dev", "glitch.me", "replit.app",
  "blogspot.com", "wordpress.com", "azurewebsites.net", "cloudfront.net", "amazonaws.com", "s3.amazonaws.com",
  "ngrok.io", "ngrok-free.app", "surge.sh", "neocities.org", "myshopify.com", "wixsite.com", "squarespace.com",
]);
/** Second-level labels that countries use as public suffixes: co.uk, com.au, com.ng, gov.za... */
const COUNTRY_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "mil", "nic", "ltd", "plc", "sch"]);

/**
 * The registrable site of a host: "mail.google.com" and "accounts.google.com" are both
 * "google.com"; "bank.co.uk" and "evil.co.uk" are different. Ports are ignored, and an IP
 * address is its own site.
 */
export function siteOf(host: string): string {
  let name = host.trim().toLowerCase();
  if (name.startsWith("[")) return name.slice(0, name.indexOf("]") + 1); // IPv6, with or without a port
  name = name.replace(/:\d+$/, "").replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return name;
  const labels = name.split(".");
  let suffix = 1;
  for (const shared of SHARED_SUFFIXES) {
    if (name === shared || name.endsWith(`.${shared}`)) suffix = Math.max(suffix, shared.split(".").length);
  }
  if (suffix === 1 && labels.length >= 3 && labels.at(-1)!.length === 2 && COUNTRY_SECOND_LEVEL.has(labels.at(-2)!)) suffix = 2;
  return labels.slice(-(suffix + 1)).join(".");
}

const normalize = (label: string) => label.replace(/\s+/g, " ").trim();

/** The part of a label that is read: all of a short one, the first words of a long button. */
function readable(label: string, isLink: boolean): string | undefined {
  if (!label) return undefined;
  if (label.length <= MAX_LABEL) return label;
  return isLink ? undefined : label.split(" ").slice(0, LEADING_WORDS).join(" ");
}

const classified = (category: ActionCategory, blockedBecause?: string): ClassifiedAction => ({
  category,
  words: WORDS[category],
  ...PROPERTIES[category],
  ...(blockedBecause && { blockedBecause }),
});

export function classifyAction(signals: ActionSignals): ClassifiedAction | undefined {

  if (signals.formHasPassword && signals.formActionHost && siteOf(signals.formActionHost) !== siteOf(signals.pageHost)) {
    return classified(
      "credentials",
      `This form would send your password to ${signals.formActionHost}, not to ${signals.pageHost}, the site you are on.`,
    );
  }
  if (signals.formHasCardField) return classified("payment");

  const labels = [signals.label, ...(signals.otherLabels ?? [])]
    .map(normalize)
    .map((label) => readable(label, !!signals.isLink))
    .filter((label): label is string => !!label);
  // The categories are in order of consequence, so a control labelled two ways ("Continue",
  // aria-label "Pay now") is classified by its most consequential label.
  for (const [category, pattern] of PATTERNS) {
    if (!labels.some((label) => pattern.test(label))) continue;
    // "Send" over an amount and an IBAN sends money, not a message.
    return classified(category === "send" && signals.moneyFields ? "payment" : category);
  }
  if (signals.moneyFields && labels.some((label) => GENERIC_CONFIRM.test(label))) return classified("payment");
  return undefined;
}

/** A dollar, euro or pound amount in the label, for the explanation: "Pay $1,240" gives "$1,240". */
export function amountIn(label: string): string | undefined {
  return label.match(/[$€£]\s?\d[\d,]*(\.\d{2})?|\d[\d,]*(\.\d{2})?\s?(USD|EUR|GBP|NGN|₦)/i)?.[0];
}
