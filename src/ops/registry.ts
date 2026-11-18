import { DEFAULT_POLICY } from "../domain/policyConfig";
import type { DataSensitivity } from "../domain/types";

/**
 * What Edge Guard knows about a tool, independent of what the agent claims.
 * The agent supplies only the tool name, its arguments and a reason.
 */
export interface ToolMeta {
  /** The system the tool acts on, shown to the risk assessor as the target. */
  system: string;
  description: string;
  sensitivity: DataSensitivity;
  reversible: boolean;
  /** Reads state without changing it. */
  readOnly: boolean;
  /**
   * Changes state, but so little that a model call adds nothing: with reversible and
   * public or internal data, the call is allowed by rule.
   */
  lowImpact?: boolean;
  /**
   * The argument naming where data goes, and what happens when it is outside the
   * organization's domains. Checked deterministically, before any model call.
   */
  egress?: { arg: string; outside: "deny" | "escalate" };
  /**
   * The argument naming who or what the call acts on. A wildcard there ("all", "*",
   * "everyone") means the call acts on everything, so a person approves it whatever
   * the assessor says. Checked deterministically, before any model call.
   */
  fanout?: { arg: string };
}

/** Values that mean "every target" in a fanout argument, unless the policy sets its own. */
export const WILDCARD_TARGETS = DEFAULT_POLICY.wildcardTargets;

/** Compared without case or surrounding spaces. */
export function isWildcardTarget(value: unknown, wildcards: string[] = WILDCARD_TARGETS): boolean {
  return typeof value === "string" && wildcards.includes(value.trim().toLowerCase());
}

/** Domains that count as inside the organization. */
export const INTERNAL_DOMAINS = ["northwind.example"];

export type ToolRegistry = Record<string, ToolMeta>;

/** Unregistered tools are treated as the worst case, which the hard rules deny. */
export const UNKNOWN_TOOL: ToolMeta = {
  system: "unregistered system",
  description: "A tool that is not in the registry.",
  sensitivity: "restricted",
  reversible: false,
  readOnly: false,
};

export const defaultRegistry: ToolRegistry = {
  read_ticket: {
    system: "Northwind helpdesk",
    description: "Read a support ticket.",
    sensitivity: "internal",
    reversible: true,
    readOnly: true,
  },
  lookup_user: {
    system: "Northwind directory",
    description: "Read a user's account status and active sessions.",
    sensitivity: "internal",
    reversible: true,
    readOnly: true,
  },
  revoke_sessions: {
    system: "Northwind identity provider",
    description: "Sign a user out of every active session. They can sign in again.",
    sensitivity: "internal",
    reversible: true,
    readOnly: false,
    fanout: { arg: "userId" },
  },
  disable_user: {
    system: "Northwind identity provider",
    description: "Disable a user's account until an administrator re-enables it.",
    sensitivity: "confidential",
    reversible: true,
    readOnly: false,
    fanout: { arg: "userId" },
  },
  add_ticket_note: {
    system: "Northwind helpdesk",
    description: "Add an internal note to a ticket.",
    sensitivity: "internal",
    reversible: true,
    readOnly: false,
    lowImpact: true,
  },
  email_user: {
    system: "Northwind outbox",
    description: "Send an email. A sent email cannot be recalled.",
    sensitivity: "internal",
    reversible: false,
    readOnly: false,
    egress: { arg: "to", outside: "escalate" },
  },
  export_customers: {
    system: "Northwind CRM",
    description: "Export customer records to a destination.",
    sensitivity: "restricted",
    reversible: false,
    readOnly: false,
    egress: { arg: "destination", outside: "deny" },
  },
  delete_audit_logs: {
    system: "Northwind audit trail",
    description: "Permanently delete audit log entries.",
    sensitivity: "restricted",
    reversible: false,
    readOnly: false,
  },
};

export function lookupTool(registry: ToolRegistry, tool: string): ToolMeta & { registered: boolean } {
  const meta = Object.hasOwn(registry, tool) ? registry[tool] : undefined;
  return meta ? { ...meta, registered: true } : { ...UNKNOWN_TOOL, registered: false };
}

/**
 * The destination's domain, or undefined when it cannot be determined. Only a single
 * plain address or a single URL has one: a list of recipients, a display name, or a
 * second "@" (as in "a@evil.co, b@northwind.example") is undetermined, so it counts as outside.
 */
export function destinationDomain(destination: unknown): string | undefined {
  if (typeof destination !== "string") return undefined;
  const value = destination.trim().toLowerCase();
  if (!value || /[\s,;<>"'()\\]/.test(value)) return undefined;
  if (value.includes("://")) {
    try {
      const url = new URL(value);
      return url.username || url.password ? undefined : url.hostname || undefined;
    } catch {
      return undefined;
    }
  }
  const parts = value.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(parts[1]) ? parts[1] : undefined;
}

/** An unparseable destination counts as outside: the rule fails closed. */
export function isInternalDestination(destination: unknown, domains = INTERNAL_DOMAINS): boolean {
  const domain = destinationDomain(destination);
  return !!domain && domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}
