import { cleanText, isoDate, LIMITS, type Priority, type TicketInput, type TicketSource } from "../types";

/**
 * Jira Service Management. Planned, not connected.
 *
 * Authentication: a Jira Cloud webhook (issue created) posts to the intake endpoint
 * and signs the request with a shared secret, which the endpoint checks before
 * normalizing. Reading attachments or comments would use OAuth 2.0 (3LO) with the
 * read:jira-work scope, held server side, never in the browser.
 */

interface JiraIssue {
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    reporter?: { emailAddress?: string; displayName?: string };
    priority?: { name?: string };
    created?: string;
    attachment?: { filename?: string; content?: string }[];
  };
}

const priorities: Record<string, Priority> = {
  highest: "urgent",
  high: "high",
  medium: "normal",
  low: "low",
  lowest: "low",
};

/** Jira Cloud's v3 API returns descriptions as Atlassian Document Format; keep the text. */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  const inner = (n.content ?? []).map(adfToText).join("");
  return n.type === "paragraph" || n.type === "heading" ? `${inner}\n` : inner;
}

export function fromJira(payload: unknown): TicketInput {
  const issue = ((payload as { issue?: JiraIssue })?.issue ?? {}) as JiraIssue;
  const fields = issue.fields ?? {};
  return {
    source: "jira",
    externalRef: cleanText(issue.key, "issue key", 64),
    title: cleanText(fields.summary, "summary", LIMITS.title),
    body: cleanText(adfToText(fields.description), "description", LIMITS.body),
    requester: cleanText(fields.reporter?.emailAddress ?? fields.reporter?.displayName, "reporter", LIMITS.requester),
    priority: priorities[(fields.priority?.name ?? "").toLowerCase()] ?? "normal",
    createdAt: isoDate(fields.created),
    attachments: (fields.attachment ?? [])
      .filter((a) => a.filename)
      .map((a) => ({ name: a.filename!, url: a.content })),
    raw: payload,
  };
}

export const jiraSource: TicketSource = {
  id: "jira",
  name: "Jira Service Management",
  status: "planned",
  describe: () => "New requests from a Jira Service Management project, sent by an issue-created webhook.",
  auth: "Signed webhook with a shared secret; OAuth 2.0 (3LO) on the server for reading attachments.",
  mapping: [
    { from: "issue.key", to: "externalRef" },
    { from: "issue.fields.summary", to: "title" },
    { from: "issue.fields.description", to: "body", note: "Atlassian Document Format, reduced to plain text" },
    { from: "issue.fields.reporter.emailAddress", to: "requester", note: "falls back to displayName" },
    { from: "issue.fields.priority.name", to: "priority", note: "Highest to urgent, High to high, Medium to normal, Low and Lowest to low" },
    { from: "issue.fields.created", to: "createdAt" },
    { from: "issue.fields.attachment[].filename, .content", to: "attachments" },
  ],
};
