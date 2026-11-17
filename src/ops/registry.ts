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
}

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
  },
  disable_user: {
    system: "Northwind identity provider",
    description: "Disable a user's account until an administrator re-enables it.",
    sensitivity: "confidential",
    reversible: true,
    readOnly: false,
  },
  add_ticket_note: {
    system: "Northwind helpdesk",
    description: "Add an internal note to a ticket.",
    sensitivity: "internal",
    reversible: true,
    readOnly: false,
  },
  email_user: {
    system: "Northwind outbox",
    description: "Send an email. A sent email cannot be recalled.",
    sensitivity: "internal",
    reversible: false,
    readOnly: false,
  },
  export_customers: {
    system: "Northwind CRM",
    description: "Export customer records to a destination.",
    sensitivity: "restricted",
    reversible: false,
    readOnly: false,
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
