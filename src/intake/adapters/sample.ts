import { initialNorthwindState } from "../../ops/northwind";
import type { Ticket, TicketSource } from "../types";

const SAMPLE_CREATED = "2026-11-17T08:12:00.000Z";

/** The built-in Northwind scenario, including ticket #482 with its planted instruction. */
export const sampleTickets: Ticket[] = initialNorthwindState().tickets.map((t) => ({
  id: `sample:${t.id}`,
  number: t.id,
  source: "sample",
  externalRef: `NW-${t.id}`,
  title: t.subject,
  body: t.body,
  requester: t.requester,
  priority: t.id === 482 ? "urgent" : "normal",
  createdAt: SAMPLE_CREATED,
  raw: t,
}));

export const sampleSource: TicketSource = {
  id: "sample",
  name: "Sample scenario",
  status: "available",
  describe: () => "Northwind's built-in tickets, including #482 with an attacker's hidden instruction.",
  listTickets: async () => sampleTickets,
};
