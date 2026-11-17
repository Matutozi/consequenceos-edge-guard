import { defaultRegistry, INTERNAL_DOMAINS, type ToolMeta, type ToolRegistry } from "./registry";
import type { DataSensitivity } from "../domain/types";

/** Remote Config parameter names. Keep in sync with remoteconfig.template.json. */
export const REGISTRY_PARAM = "tool_registry";
export const DOMAINS_PARAM = "internal_domains";

export interface LoadedRegistry {
  registry: ToolRegistry;
  internalDomains: string[];
  /** Where the registry came from, for display. */
  source: "remote-config" | "bundled-defaults";
  /** Tools present in the remote registry but rejected as malformed. */
  rejected: string[];
  /** Why the bundled defaults were used, when they were. */
  fallbackReason?: string;
}

const SENSITIVITIES: DataSensitivity[] = ["public", "internal", "confidential", "restricted"];
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function parseToolMeta(value: unknown): ToolMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (
    typeof v.system !== "string" ||
    typeof v.description !== "string" ||
    !SENSITIVITIES.includes(v.sensitivity as DataSensitivity) ||
    typeof v.reversible !== "boolean" ||
    typeof v.readOnly !== "boolean"
  ) {
    return undefined;
  }
  const meta: ToolMeta = {
    system: v.system,
    description: v.description,
    sensitivity: v.sensitivity as DataSensitivity,
    reversible: v.reversible,
    readOnly: v.readOnly,
  };
  if (v.lowImpact !== undefined) {
    if (typeof v.lowImpact !== "boolean") return undefined;
    meta.lowImpact = v.lowImpact;
  }
  if (v.egress !== undefined) {
    const egress = v.egress as Record<string, unknown> | null;
    if (
      !egress ||
      typeof egress.arg !== "string" ||
      (egress.outside !== "deny" && egress.outside !== "escalate")
    ) {
      return undefined;
    }
    meta.egress = { arg: egress.arg, outside: egress.outside };
  }
  return meta;
}

/**
 * Parses a registry from Remote Config JSON. Malformed entries are dropped, which
 * makes those tools unregistered and therefore denied: a bad config can only make
 * Edge Guard stricter, never looser.
 */
export function parseRegistry(json: string): { registry: ToolRegistry; rejected: string[] } {
  const raw: unknown = JSON.parse(json);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The registry must be a JSON object keyed by tool name.");
  }
  const registry: ToolRegistry = {};
  const rejected: string[] = [];
  for (const [tool, value] of Object.entries(raw)) {
    const meta = TOOL_NAME.test(tool) ? parseToolMeta(value) : undefined;
    if (meta) registry[tool] = meta;
    else rejected.push(tool);
  }
  return { registry, rejected };
}

export function parseDomains(json: string): string[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("internal_domains must be a JSON array.");
  const domains = raw
    .filter((d): d is string => typeof d === "string")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => DOMAIN.test(d));
  if (domains.length === 0) throw new Error("internal_domains has no valid domains.");
  return domains;
}

export const bundledRegistry = (fallbackReason?: string): LoadedRegistry => ({
  registry: defaultRegistry,
  internalDomains: INTERNAL_DOMAINS,
  source: "bundled-defaults",
  rejected: [],
  fallbackReason,
});

/**
 * Loads the tool registry from Firebase Remote Config. If Remote Config is
 * unreachable, has no template yet, or holds invalid JSON, the registry bundled
 * with the app is used and the reason is reported.
 */
export async function loadToolRegistry(): Promise<LoadedRegistry> {
  try {
    const [{ getFirebaseApp }, rc] = await Promise.all([
      import("../firebase"),
      import("firebase/remote-config"),
    ]);
    const remoteConfig = rc.getRemoteConfig(getFirebaseApp());
    // A first visit must register an installation before fetching, which can take
    // several seconds on slow networks.
    remoteConfig.settings.fetchTimeoutMillis = 15_000;
    remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60_000;

    // Repeat visits use the last activated registry at once and refresh it in the
    // background for next time; only a first visit waits for the network.
    await rc.ensureInitialized(remoteConfig);
    if (rc.getValue(remoteConfig, REGISTRY_PARAM).getSource() === "remote") {
      void rc.fetchAndActivate(remoteConfig).catch(() => {});
    } else {
      await rc.fetchAndActivate(remoteConfig);
    }

    const registryValue = rc.getValue(remoteConfig, REGISTRY_PARAM);
    if (registryValue.getSource() !== "remote") {
      return bundledRegistry("Remote Config has no tool_registry parameter yet.");
    }
    const { registry, rejected } = parseRegistry(registryValue.asString());

    const domainsValue = rc.getValue(remoteConfig, DOMAINS_PARAM);
    const internalDomains =
      domainsValue.getSource() === "remote" ? parseDomains(domainsValue.asString()) : INTERNAL_DOMAINS;

    return { registry, internalDomains, source: "remote-config", rejected };
  } catch (caught) {
    return bundledRegistry(
      `Remote Config could not be loaded: ${caught instanceof Error ? caught.message : "unknown error"}`,
    );
  }
}
