import { cleanText, isoDate, LIMITS, type Priority, type TicketInput, type TicketSource } from "../types";

/**
 * ServiceNow incidents. Planned, not connected.
 *
 * Authentication: a business rule on the incident table calls an outbound REST
 * message to the intake endpoint, authenticated with an OAuth 2.0 client
 * credential or a mutual-TLS profile. Reading back would use a dedicated
 * integration user with read access to the incident table only.
 */

interface ServiceNowIncident {
  sys_id?: string;
  number?: string;
  short_description?: string;
  description?: string;
  caller_id?: string | { display_value?: string; value?: string };
  priority?: string;
  sys_created_on?: string;
}

/** ServiceNow priorities are "1 - Critical" to "5 - Planning"; the leading digit decides. */
function priority(value: string | undefined): Priority {
  const level = Number.parseInt(value ?? "", 10);
  return level === 1 ? "urgent" : level === 2 ? "high" : level === 3 ? "normal" : level >= 4 ? "low" : "normal";
}

export function fromServiceNow(payload: unknown): TicketInput {
  const incident = ((payload as { result?: ServiceNowIncident })?.result ?? payload ?? {}) as ServiceNowIncident;
  const caller = typeof incident.caller_id === "string" ? incident.caller_id : incident.caller_id?.display_value;
  const shortDescription = cleanText(incident.short_description, "short description", LIMITS.title);
  return {
    source: "servicenow",
    externalRef: cleanText(incident.number ?? incident.sys_id, "incident number", 64),
    title: shortDescription,
    body: cleanText(incident.description || shortDescription, "description", LIMITS.body),
    requester: cleanText(caller, "caller", LIMITS.requester),
    priority: priority(incident.priority),
    // ServiceNow sends "2026-11-17 14:03:00" in UTC.
    createdAt: isoDate(incident.sys_created_on ? `${incident.sys_created_on.replace(" ", "T")}Z` : undefined),
    raw: payload,
  };
}

export const serviceNowSource: TicketSource = {
  id: "servicenow",
  name: "ServiceNow",
  status: "planned",
  describe: () => "New incidents from ServiceNow, sent by a business rule through an outbound REST message.",
  auth: "OAuth 2.0 client credentials or mutual TLS on the outbound REST message; read-only integration user.",
  mapping: [
    { from: "number", to: "externalRef", note: "falls back to sys_id" },
    { from: "short_description", to: "title" },
    { from: "description", to: "body", note: "falls back to short_description" },
    { from: "caller_id.display_value", to: "requester" },
    { from: "priority", to: "priority", note: "1 urgent, 2 high, 3 normal, 4 and 5 low" },
    { from: "sys_created_on", to: "createdAt", note: "UTC" },
  ],
};
