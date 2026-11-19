import type { DataSensitivity } from "../../src/domain/types";

/**
 * What a click or form submission on a web page would do, decided by rule from what the
 * page shows: the button's label and the fields in its form. No model, no page content.
 * Most clicks are none of these and pass untouched.
 */
export type ActionCategory = "credentials" | "payment" | "delete" | "share" | "send";

export interface ActionSignals {
  /** The visible label of the button or link: its text, value, aria-label or title. */
  label: string;
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

/** Labels longer than this are content, not a button. */
const MAX_LABEL = 60;

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

/** The last two labels of a host name: "mail.google.com" becomes "google.com". */
export function siteOf(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").split(".").slice(-2).join(".");
}

const classified = (category: ActionCategory, blockedBecause?: string): ClassifiedAction => ({
  category,
  words: WORDS[category],
  ...PROPERTIES[category],
  ...(blockedBecause && { blockedBecause }),
});

export function classifyAction(signals: ActionSignals): ClassifiedAction | undefined {
  const label = signals.label.replace(/\s+/g, " ").trim();

  if (signals.formHasPassword && signals.formActionHost && siteOf(signals.formActionHost) !== siteOf(signals.pageHost)) {
    return classified(
      "credentials",
      `This form would send your password to ${signals.formActionHost}, not to ${signals.pageHost}, the site you are on.`,
    );
  }
  if (signals.formHasCardField) return classified("payment");
  if (!label || label.length > MAX_LABEL) return undefined;

  for (const [category, pattern] of PATTERNS) {
    if (pattern.test(label)) return classified(category);
  }
  return undefined;
}

/** A dollar, euro or pound amount in the label, for the explanation: "Pay $1,240" gives "$1,240". */
export function amountIn(label: string): string | undefined {
  return label.match(/[$€£]\s?\d[\d,]*(\.\d{2})?|\d[\d,]*(\.\d{2})?\s?(USD|EUR|GBP|NGN|₦)/i)?.[0];
}
