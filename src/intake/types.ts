/** Where a ticket came from. */
export type SourceId = "manual" | "sample" | "webhook" | "jira" | "zendesk" | "servicenow" | "email";

export type Priority = "low" | "normal" | "high" | "urgent";

export interface Attachment {
  name: string;
  url?: string;
}

/** A ticket from any source, in one shape the agent and the guard can rely on. */
export interface Ticket {
  /** Unique across all sources, for example "manual:1001". */
  id: string;
  /** The ticket number in Northwind's helpdesk, which the agent's tools use. */
  number: number;
  source: SourceId;
  /** The ticket's ID in the system it came from, for example a Jira key. */
  externalRef: string;
  title: string;
  body: string;
  requester: string;
  priority: Priority;
  createdAt: string;
  attachments?: Attachment[];
  /** The original payload, kept for audit. It is untrusted input. */
  raw: unknown;
}

/** What an adapter produces. The queue assigns the ID and helpdesk number. */
export type TicketInput = Omit<Ticket, "id" | "number">;

export type Unsubscribe = () => void;

export interface FieldMapping {
  /** The field in the source system's payload. */
  from: string;
  /** The Ticket field it fills. */
  to: keyof TicketInput;
  note?: string;
}

export interface TicketSource {
  id: SourceId;
  name: string;
  status: "available" | "not_connected" | "planned";
  /** One line on what the source is. */
  describe(): string;
  listTickets?(): Promise<Ticket[]>;
  subscribe?(onTicket: (ticket: Ticket) => void): Unsubscribe;
  /** How the source's payload maps to a Ticket, shown on the Integrations page. */
  mapping?: FieldMapping[];
  /** How authentication would work, for sources that are not built yet. */
  auth?: string;
}

/** Ticket text is untrusted input; cap it so one payload can't flood the agent. */
export const LIMITS = { title: 200, body: 8000, requester: 200 } as const;

export class InvalidTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTicketError";
  }
}

export function cleanText(value: unknown, field: string, max: number, required = true): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new InvalidTicketError(`The ticket has no ${field}.`);
  return text.length > max ? text.slice(0, max) : text;
}

export function isoDate(value: unknown): string {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
