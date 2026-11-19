import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY, STRICTEST_POLICY } from "../domain/policyConfig";
import { evaluatePolicy } from "../domain/policy";
import type { RiskAssessment } from "../domain/types";
import { defaultRegistry, lookupTool } from "./registry";
import { decideByRules, toProposal } from "./toolGuard";

/**
 * loadToolRegistry against a stand-in for Remote Config. Found in the audit: when Remote Config
 * could not be reached, the bundled defaults applied, which can be looser than what was
 * published, so a failed (or blocked) fetch could undo a tightened policy or a revoked tool.
 */
type Source = "remote" | "default" | "static";
const remote = vi.hoisted(() => ({
  values: {} as Record<string, { source: Source; value: string }>,
  cached: false,
  fetch: (async () => true) as () => Promise<boolean>,
}));

vi.mock("../firebase", () => ({ getFirebaseApp: () => ({}) }));
vi.mock("firebase/remote-config", () => ({
  getRemoteConfig: () => ({ settings: {} }),
  ensureInitialized: async () => undefined,
  fetchAndActivate: () => remote.fetch(),
  getValue: (_: unknown, key: string) => {
    const entry = remote.values[key] ?? { source: "static" as Source, value: "" };
    const cachedSource = remote.cached ? entry.source : "static";
    return { getSource: () => cachedSource, asString: () => entry.value };
  },
}));

const { loadToolRegistry, REGISTRY_PARAM, POLICY_PARAM } = await import("./registryConfig");

/** What becomes of a routine read under a policy, with the assessor rating it low. */
function routineRead(policy: typeof DEFAULT_POLICY) {
  const call = { tool: "read_ticket", args: { ticketId: 482 } };
  const ruled = decideByRules(call, defaultRegistry, undefined, policy);
  if (ruled) return ruled.decision;
  const proposal = toProposal({ ...call, agent: "a", reason: "r" }, lookupTool(defaultRegistry, call.tool));
  const low: RiskAssessment = { riskLevel: "low", summary: "", reasons: [], sensitiveData: [], blastRadius: "single_user", recommendedControl: "allow" };
  return evaluatePolicy(proposal, low, policy).decision;
}

beforeEach(() => {
  remote.values = {};
  remote.cached = false;
  remote.fetch = async () => {
    remote.cached = true;
    return true;
  };
});

describe("loadToolRegistry", () => {
  it("uses the strictest policy when Remote Config cannot be reached", async () => {
    remote.fetch = async () => {
      throw new Error("Failed to fetch");
    };
    const loaded = await loadToolRegistry();
    expect(loaded).toMatchObject({ source: "bundled-defaults", unreachable: true, policy: STRICTEST_POLICY });
    expect(loaded.fallbackReason).toMatch(/could not be loaded: Failed to fetch/);
    expect(loaded.policyTightened).toHaveLength(Object.keys(STRICTEST_POLICY).length);
    // Even a read goes to a person: nothing is allowed on a policy nobody could read.
    expect(routineRead(loaded.policy)).toBe("require_approval");
  });

  it("uses the strictest policy when what is published cannot be read", async () => {
    remote.values[REGISTRY_PARAM] = { source: "remote", value: "{not json" };
    const loaded = await loadToolRegistry();
    expect(loaded).toMatchObject({ unreachable: true, policy: STRICTEST_POLICY });
  });

  it("uses the defaults when Remote Config answers but nothing is published", async () => {
    const loaded = await loadToolRegistry();
    expect(loaded).toMatchObject({ source: "bundled-defaults", unreachable: false, policy: DEFAULT_POLICY, policyTightened: [] });
    expect(loaded.fallbackReason).toMatch(/no tool_registry parameter yet/);
    expect(routineRead(loaded.policy)).toBe("allow");
  });

  it("uses what is published when it can be read", async () => {
    const published = { ...DEFAULT_POLICY, approvalAtRisk: "low" };
    remote.values[REGISTRY_PARAM] = { source: "remote", value: JSON.stringify({ read_ticket: defaultRegistry.read_ticket }) };
    remote.values[POLICY_PARAM] = { source: "remote", value: JSON.stringify(published) };
    const loaded = await loadToolRegistry();
    expect(loaded).toMatchObject({ source: "remote-config", unreachable: false, policy: published });
    expect(Object.keys(loaded.registry)).toEqual(["read_ticket"]);
  });

  it("keeps a previously fetched registry when a later refresh fails", async () => {
    remote.values[REGISTRY_PARAM] = { source: "remote", value: JSON.stringify(defaultRegistry) };
    remote.cached = true;
    remote.fetch = async () => {
      throw new Error("offline");
    };
    const loaded = await loadToolRegistry();
    expect(loaded).toMatchObject({ source: "remote-config", unreachable: false });
  });
});
