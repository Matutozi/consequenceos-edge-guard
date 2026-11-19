import { DEFAULT_POLICY, parsePolicy, STRICTEST_POLICY, type PolicyConfig } from "../domain/policyConfig";
import { defaultRegistry, INTERNAL_DOMAINS, type ToolMeta, type ToolRegistry } from "./registry";
import type { DataSensitivity } from "../domain/types";

/** Remote Config parameter names. Keep in sync with remoteconfig.template.json. */
export const REGISTRY_PARAM = "tool_registry";
export const DOMAINS_PARAM = "internal_domains";
export const POLICY_PARAM = "guard_policy";

export interface LoadedRegistry {
  registry: ToolRegistry;
  internalDomains: string[];
  /** Where the registry came from, for display. */
  source: "remote-config" | "bundled-defaults";
  /** Tools present in the remote registry but rejected as malformed. */
  rejected: string[];
  /** Why the bundled defaults were used, when they were. */
  fallbackReason?: string;
  /**
   * Remote Config could not be reached or read, so what is published is unknown: it may be
   * stricter than what is bundled (a tool revoked, a threshold lowered). The bundled registry
   * is used with the strictest policy, so a person approves every call a rule does not deny.
   */
  unreachable: boolean;
  /** The adjustable thresholds. The default policy until one is published. */
  policy: PolicyConfig;
  /** Policy fields that were malformed in Remote Config and fell back to their strictest value. */
  policyTightened: string[];
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
  if (v.fanout !== undefined) {
    const fanout = v.fanout as Record<string, unknown> | null;
    if (!fanout || typeof fanout.arg !== "string") return undefined;
    meta.fanout = { arg: fanout.arg };
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

/**
 * The registry bundled with the app. With nothing published, its default policy applies.
 * When Remote Config could not be read (`unreachable`), the strictest policy applies instead:
 * falling back to the defaults would let a fetch failure, or someone blocking the request,
 * undo whatever was published to tighten them.
 */
export const bundledRegistry = (fallbackReason?: string, { unreachable = false } = {}): LoadedRegistry => ({
  registry: defaultRegistry,
  internalDomains: INTERNAL_DOMAINS,
  source: "bundled-defaults",
  rejected: [],
  fallbackReason,
  unreachable,
  policy: unreachable ? STRICTEST_POLICY : DEFAULT_POLICY,
  policyTightened: unreachable ? (Object.keys(STRICTEST_POLICY) as (keyof PolicyConfig)[]) : [],
});

/** An unpublished policy means the defaults; a published but malformed one tightens. */
export function policyFromRemote(source: string, json: string): { policy: PolicyConfig; tightened: string[] } {
  if (source !== "remote") return { policy: DEFAULT_POLICY, tightened: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = undefined;
  }
  return parsePolicy(raw);
}

/**
 * Loads the tool registry from Firebase Remote Config. With no template published yet, the
 * registry and policy bundled with the app are used. If Remote Config is unreachable or holds
 * invalid JSON, the bundled registry is used with the strictest policy (see bundledRegistry).
 * Either way the reason is reported.
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

    const policyValue = rc.getValue(remoteConfig, POLICY_PARAM);
    const { policy, tightened } = policyFromRemote(policyValue.getSource(), policyValue.asString());

    return { registry, internalDomains, source: "remote-config", rejected, unreachable: false, policy, policyTightened: tightened };
  } catch (caught) {
    // Unreachable, or published but unreadable: what is published is unknown, so be strictest.
    return bundledRegistry(
      `Remote Config could not be loaded: ${caught instanceof Error ? caught.message : "unknown error"}`,
      { unreachable: true },
    );
  }
}
