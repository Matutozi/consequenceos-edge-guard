import { cleanText, isoDate, LIMITS, type Priority, type TicketInput, type TicketSource } from "../types";

/**
 * Zendesk. Planned, not connected.
 *
 * Authentication: a Zendesk trigger sends new tickets to the intake endpoint through
 * a webhook. Zendesk signs each request (X-Zendesk-Webhook-Signature, HMAC-SHA256
 * over the timestamp and body), which the endpoint verifies. Fetching full ticket
 * details would use an OAuth access token held on the server.
 */

interface ZendeskTicket {
  id?: number | string;
  subject?: string;
  description?: string;
  requester?: { email?: string; name?: string };
  priority?: string | null;
  created_at?: string;
  attachments?: { file_name?: string; content_url?: string }[];
}

const priorities: Record<string, Priority> = { urgent: "urgent", high: "high", normal: "normal", low: "low" };

export function fromZendesk(payload: unknown): TicketInput {
  const ticket = ((payload as { ticket?: ZendeskTicket })?.ticket ?? {}) as ZendeskTicket;
  return {
    source: "zendesk",
    externalRef: cleanText(ticket.id === undefined ? undefined : String(ticket.id), "ticket id", 64),
    title: cleanText(ticket.subject, "subject", LIMITS.title),
    body: cleanText(ticket.description, "description", LIMITS.body),
    requester: cleanText(ticket.requester?.email ?? ticket.requester?.name, "requester", LIMITS.requester),
    priority: priorities[ticket.priority ?? ""] ?? "normal",
    createdAt: isoDate(ticket.created_at),
    attachments: (ticket.attachments ?? [])
      .filter((a) => a.file_name)
      .map((a) => ({ name: a.file_name!, url: a.content_url })),
    raw: payload,
  };
}

export const zendeskSource: TicketSource = {
  id: "zendesk",
  name: "Zendesk",
  status: "planned",
  describe: () => "New Zendesk tickets, sent by a trigger through a signed webhook.",
  auth: "Webhook signed with HMAC-SHA256 (X-Zendesk-Webhook-Signature); OAuth on the server for full details.",
  mapping: [
    { from: "ticket.id", to: "externalRef" },
    { from: "ticket.subject", to: "title" },
    { from: "ticket.description", to: "body", note: "the first comment" },
    { from: "ticket.requester.email", to: "requester", note: "falls back to name" },
    { from: "ticket.priority", to: "priority", note: "same four levels; empty becomes normal" },
    { from: "ticket.created_at", to: "createdAt" },
    { from: "ticket.attachments[].file_name, .content_url", to: "attachments" },
  ],
};
