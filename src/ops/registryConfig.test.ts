import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultRegistry, INTERNAL_DOMAINS } from "./registry";
import { DOMAINS_PARAM, parseDomains, parseRegistry, REGISTRY_PARAM } from "./registryConfig";

const template = JSON.parse(
  readFileSync(new URL("../../remoteconfig.template.json", import.meta.url), "utf8"),
) as { parameters: Record<string, { defaultValue: { value: string }; valueType: string }> };

describe("parseRegistry", () => {
  it("round-trips the bundled registry", () => {
    expect(parseRegistry(JSON.stringify(defaultRegistry))).toEqual({
      registry: defaultRegistry,
      rejected: [],
    });
  });

  it("drops malformed entries so those tools become unregistered", () => {
    const { registry, rejected } = parseRegistry(
      JSON.stringify({
        read_ticket: defaultRegistry.read_ticket,
        loose_tool: { system: "x", description: "y", sensitivity: "public" },
        bad_sensitivity: { ...defaultRegistry.read_ticket, sensitivity: "secret" },
        bad_egress: { ...defaultRegistry.export_customers, egress: { arg: "destination", outside: "allow" } },
        bad_low_impact: { ...defaultRegistry.read_ticket, lowImpact: "yes" },
        "Bad-Name": defaultRegistry.read_ticket,
      }),
    );
    expect(Object.keys(registry)).toEqual(["read_ticket"]);
    expect(rejected).toEqual(["loose_tool", "bad_sensitivity", "bad_egress", "bad_low_impact", "Bad-Name"]);
  });

  it("rejects a registry that is not an object", () => {
    expect(() => parseRegistry("[]")).toThrow(/JSON object/);
    expect(() => parseRegistry("not json")).toThrow();
  });
});

describe("parseDomains", () => {
  it("normalizes valid domains and drops invalid ones", () => {
    expect(parseDomains('[" Northwind.Example ", "not a domain", 3]')).toEqual(["northwind.example"]);
  });

  it("refuses an empty domain list", () => {
    expect(() => parseDomains("[]")).toThrow(/no valid domains/);
  });
});

describe("remoteconfig.template.json", () => {
  it("publishes exactly the bundled registry and domains", () => {
    expect(template.parameters[REGISTRY_PARAM].valueType).toBe("JSON");
    expect(JSON.parse(template.parameters[REGISTRY_PARAM].defaultValue.value)).toEqual(defaultRegistry);
    expect(JSON.parse(template.parameters[DOMAINS_PARAM].defaultValue.value)).toEqual(INTERNAL_DOMAINS);
  });
});
