import { cleanText, isoDate, LIMITS, type Priority, type TicketInput, type TicketSource } from "../types";

/**
 * Generic webhook. Planned: the contract is fixed here, the endpoint is not deployed.
 * Cloud Functions need the Blaze plan, and an open endpoint whose tickets an agent
 * acts on is an injection channel by design, so it ships only with authentication.
 *
 * Authentication: each source system gets its own bearer token, stored hashed. The
 * endpoint rejects requests without a valid token, limits request size and rate per
 * token, and records which token posted each ticket.
 */

export const WEBHOOK_PATH = "/api/tickets";

/** JSON Schema (draft 2020-12) for the request body. */
export const webhookSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Edge Guard ticket",
  type: "object",
  required: ["title", "body", "requester"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: LIMITS.title },
    body: { type: "string", minLength: 1, maxLength: LIMITS.body },
    requester: { type: "string", minLength: 1, maxLength: LIMITS.requester, description: "Email address of the person asking" },
    priority: { enum: ["low", "normal", "high", "urgent"], default: "normal" },
    externalRef: { type: "string", maxLength: 128, description: "The ticket's ID in your system" },
    createdAt: { type: "string", format: "date-time" },
    attachments: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: { name: { type: "string" }, url: { type: "string", format: "uri" } },
      },
    },
  },
} as const;

export const webhookExample = `curl -X POST "https://<your-edge-guard-host>${WEBHOOK_PATH}" \\
  -H "Authorization: Bearer <token-for-this-source>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Locked out after password change",
    "body": "I changed my password this morning and now every sign-in fails.",
    "requester": "tomas.reyes@northwind.example",
    "priority": "high",
    "externalRef": "CRM-20931"
  }'`;

const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export function fromWebhook(payload: unknown): TicketInput {
  const p = (payload ?? {}) as Record<string, unknown>;
  const priority = PRIORITIES.includes(p.priority as Priority) ? (p.priority as Priority) : "normal";
  const attachments = Array.isArray(p.attachments)
    ? p.attachments
        .slice(0, 20)
        .filter((a): a is { name: string; url?: unknown } => !!a && typeof (a as { name?: unknown }).name === "string")
        .map((a) => ({ name: a.name, url: typeof a.url === "string" ? a.url : undefined }))
    : undefined;
  return {
    source: "webhook",
    externalRef: cleanText(p.externalRef, "external reference", 128, false) || "none",
    title: cleanText(p.title, "title", LIMITS.title),
    body: cleanText(p.body, "body", LIMITS.body),
    requester: cleanText(p.requester, "requester", LIMITS.requester),
    priority,
    createdAt: isoDate(p.createdAt),
    attachments,
    raw: payload,
  };
}

export const webhookSource: TicketSource = {
  id: "webhook",
  name: "Webhook",
  status: "planned",
  describe: () => `Any system can post a ticket as JSON to ${WEBHOOK_PATH}. The contract is fixed; the endpoint is not deployed yet.`,
  auth: "A bearer token per source system, stored hashed, with size and rate limits per token.",
  mapping: [
    { from: "title", to: "title" },
    { from: "body", to: "body" },
    { from: "requester", to: "requester" },
    { from: "priority", to: "priority", note: "defaults to normal" },
    { from: "externalRef", to: "externalRef" },
    { from: "createdAt", to: "createdAt", note: "defaults to the time received" },
    { from: "attachments[]", to: "attachments" },
  ],
};
