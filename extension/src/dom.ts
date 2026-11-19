/** Builds an element with text only: page-supplied strings never become HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

export function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString();
}

/** The Prompt API, as far as these pages use it. */
export interface PromptApi {
  availability(options: unknown): Promise<string>;
  create(options: unknown): Promise<{ destroy(): void }>;
}

export const promptApi = () => (globalThis as { LanguageModel?: PromptApi }).LanguageModel;

export const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};
