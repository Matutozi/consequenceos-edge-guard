import { emailSource } from "./adapters/email";
import { jiraSource } from "./adapters/jira";
import { manualSource } from "./adapters/manual";
import { sampleSource } from "./adapters/sample";
import { serviceNowSource } from "./adapters/servicenow";
import { webhookSource } from "./adapters/webhook";
import { zendeskSource } from "./adapters/zendesk";
import type { SourceId, TicketSource } from "./types";

export * from "./types";

/** Every ticket source. Adding one means adding an adapter here; the agent and guard don't change. */
export const ticketSources: TicketSource[] = [
  manualSource,
  sampleSource,
  webhookSource,
  jiraSource,
  zendeskSource,
  serviceNowSource,
  emailSource,
];

export const sourceLabel: Record<SourceId, string> = {
  manual: "Manual",
  sample: "Sample",
  webhook: "Webhook",
  jira: "Jira",
  zendesk: "Zendesk",
  servicenow: "ServiceNow",
  email: "Email",
};
