/**
 * Hidden instructions aimed at AI agents. A page can carry text a person never sees,
 * such as white-on-white or one-pixel text, that an AI agent reading the page takes as
 * an instruction. The rules here run on plain data, so they are testable without a browser;
 * the content script gathers the text and how it is hidden.
 */

/** How a piece of text is kept from a person's view, in plain words. Absent: it is visible. */
export type HiddenHow =
  | "invisible"
  | "tiny text"
  | "the same colour as the background"
  | "placed off the screen"
  | "an HTML comment";

export interface TextBlock {
  text: string;
  hidden?: HiddenHow;
}

/** Text that speaks to an AI instead of a human reader. */
export const AI_INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|your)\b[^.]{0,20}\b(instructions?|prompts?|rules|guidelines)\b/i,
  /\b(note|message|instructions?)\s+(to|for)\s+(the\s+|any\s+)?(ai|assistant|agent|model|llm|bot)s?\b/i,
  /\b(ai|llm)\s+(agents?|assistants?|models?)\b[^.]{0,60}\b(must|should|need to|are instructed to|have to|will)\b/i,
  /\bsystem\s+(prompt|note|message|instruction|override)s?\b/i,
  /\b(you\s+are|act\s+as)\s+(now\s+)?(an?\s+)?(ai|assistant|agent|language model)\b/i,
  /\bif\s+you\s+are\s+an?\s+(ai|assistant|agent|language model|llm)\b/i,
];

export const addressesAi = (text: string) => AI_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));

export interface Finding {
  /** The text, shortened for display. */
  text: string;
  hidden?: HiddenHow;
  /** "rule": hidden and worded as an instruction to an AI. "ai": the on-device model judged it. */
  foundBy: "rule" | "ai";
  /** Plain words: why this counts. */
  why: string;
}

const MAX_SHOWN = 280;
/** Hidden text this long is worth asking the model about even without a tell-tale phrase. */
const LONG_HIDDEN = 80;
/** At most this many blocks go to the model per page, to keep a scan quick. */
export const MAX_CANDIDATES = 6;

const short = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SHOWN ? `${flat.slice(0, MAX_SHOWN - 1)}…` : flat;
};

/**
 * Splits a page's text into what the rules decide and what needs the model.
 * Hidden text worded as an instruction to an AI is a finding by rule. Visible text worded
 * that way, and long hidden text without such words, go to the model: either could be
 * innocent (an article about AI, hidden menu text).
 */
export function triage(blocks: TextBlock[]): { findings: Finding[]; candidates: TextBlock[] } {
  const findings: Finding[] = [];
  const candidates: TextBlock[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const text = short(block.text);
    if (text.length < 12 || seen.has(text)) continue;
    seen.add(text);
    const worded = addressesAi(text);
    if (block.hidden && worded) {
      findings.push({
        text,
        hidden: block.hidden,
        foundBy: "rule",
        why: `It is hidden from you (${block.hidden}) and written as an instruction to an AI.`,
      });
    } else if ((worded || (block.hidden && text.length >= LONG_HIDDEN)) && candidates.length < MAX_CANDIDATES) {
      candidates.push({ text, hidden: block.hidden });
    }
  }
  return { findings, candidates };
}

/** Relative luminance contrast between two CSS rgb() colours; 1 means identical. */
export function contrast(a: string, b: string): number | undefined {
  const parse = (c: string) => c.match(/rgba?\(([^)]+)\)/)?.[1].split(",").map((v) => parseFloat(v));
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb || pa.length < 3 || pb.length < 3) return undefined;
  const lum = ([r, g, bl]: number[]) =>
    [r, g, bl]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(pa), lum(pb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
