import type { PolicyDecision } from "../../src/domain/types";
import type { ActionCategory } from "./classify";
import type { Finding, TextBlock } from "./injection";

/** A consequential click or submission, as the content script saw it. */
export interface PageAction {
  label: string;
  category: ActionCategory;
  words: string;
  sensitivity: "internal" | "confidential";
  reversible: boolean;
  blockedBecause?: string;
  page: { host: string; title: string };
}

/** What Edge Guard decided, in words a person can read. */
export interface GuardResult {
  decision: PolicyDecision;
  /** One or two plain sentences. */
  explanation: string;
  /** Who decided: "a fixed rule", "Gemini Nano on this computer", ... */
  decidedBy: string;
  /** The receipt's SHA-256 digest, so a decision can be traced. */
  digest: string;
  receiptId: string;
}

export interface Pending {
  id: string;
  tabId: number;
  windowId?: number;
  action: PageAction;
  result: GuardResult;
}

export interface HistoryItem {
  at: string;
  site: string;
  label: string;
  words: string;
  /** What finally happened. */
  outcome: "allowed" | "blocked";
  /** Who made the final call. */
  by: string;
  explanation: string;
  digest: string;
}

export interface ScanReport {
  at: string;
  findings: Finding[];
  /** Blocks only the on-device model could judge, and whether it could. */
  aiCheck: "done" | "not-needed" | "no-model" | "failed";
  checked: number;
}

export type ToBackground =
  | { type: "guard-action"; action: PageAction }
  | { type: "scan"; findings: Finding[]; candidates: TextBlock[] }
  | { type: "record"; item: HistoryItem };

export type GuardResponse =
  | { status: "allow"; result: GuardResult }
  | { status: "pending"; id: string; result: GuardResult };

export type ToContent = { type: "decision"; id: string; allow: boolean } | { type: "scan-now" };

export const HISTORY_KEY = "history";
export const ENABLED_KEY = "enabled";
export const pendingKey = (id: string) => `pending:${id}`;
export const scanKey = (tabId: number) => `scan:${tabId}`;
export const MAX_HISTORY = 50;
