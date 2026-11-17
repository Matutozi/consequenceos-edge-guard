import { cleanText, isoDate, LIMITS, type Priority, type TicketInput, type TicketSource } from "../types";

/**
 * Email inbox. Planned, not connected.
 *
 * Authentication: either the mail provider's API reads a support mailbox (Gmail API
 * or Microsoft Graph, OAuth with a read-only mail scope, held server side), or an
 * inbound-parse service posts each message to the intake endpoint with a signing
 * secret. Email is the easiest channel to spoof, so the sender is a claim, not an
 * identity: Edge Guard never trusts it for authorization.
 */

export interface InboundEmail {
  messageId?: string;
  from?: string;
  subject?: string;
  text?: string;
  date?: string;
  headers?: Record<string, string>;
  attachments?: { filename?: string }[];
}

function priority(headers: Record<string, string> = {}): Priority {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (lower.importance === "high" || /^[12]\b/.test(lower["x-priority"] ?? "")) return "high";
  if (lower.importance === "low" || /^[45]\b/.test(lower["x-priority"] ?? "")) return "low";
  return "normal";
}

/** "Ada Okafor <ada.okafor@northwind.example>" becomes the address. */
function address(from: string | undefined): string | undefined {
  return from?.match(/<([^>]+)>/)?.[1] ?? from;
}

export function fromEmail(payload: unknown): TicketInput {
  const mail = (payload ?? {}) as InboundEmail;
  return {
    source: "email",
    externalRef: cleanText(mail.messageId, "message ID", 256),
    title: cleanText(mail.subject, "subject", LIMITS.title),
    body: cleanText(mail.text, "body", LIMITS.body),
    requester: cleanText(address(mail.from), "sender", LIMITS.requester),
    priority: priority(mail.headers),
    createdAt: isoDate(mail.date),
    attachments: (mail.attachments ?? []).filter((a) => a.filename).map((a) => ({ name: a.filename! })),
    raw: payload,
  };
}

export const emailSource: TicketSource = {
  id: "email",
  name: "Email inbox",
  status: "planned",
  describe: () => "Messages to a support mailbox, read through the mail provider's API or an inbound-parse webhook.",
  auth: "Gmail API or Microsoft Graph with a read-only scope, or a signed inbound-parse webhook. The sender is never trusted for authorization.",
  mapping: [
    { from: "Message-ID", to: "externalRef" },
    { from: "Subject", to: "title" },
    { from: "text/plain body", to: "body" },
    { from: "From", to: "requester", note: "the address only" },
    { from: "Importance or X-Priority", to: "priority", note: "high, normal or low" },
    { from: "Date", to: "createdAt" },
    { from: "attachment filenames", to: "attachments" },
  ],
};
