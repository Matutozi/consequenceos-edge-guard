// Regenerates remoteconfig.template.json from the bundled registry.
// Run: npx vite-node scripts/write-remoteconfig-template.ts
import { writeFileSync } from "node:fs";
import { defaultRegistry, INTERNAL_DOMAINS } from "../src/ops/registry";
import { DEFAULT_POLICY } from "../src/domain/policyConfig";
import { DOMAINS_PARAM, POLICY_PARAM, REGISTRY_PARAM } from "../src/ops/registryConfig";

const template = {
  parameters: {
    [REGISTRY_PARAM]: {
      defaultValue: { value: JSON.stringify(defaultRegistry) },
      description:
        "Edge Guard tool registry: sensitivity, reversibility and egress rules per tool. Malformed entries are dropped, which denies those tools.",
      valueType: "JSON",
    },
    [POLICY_PARAM]: {
      defaultValue: { value: JSON.stringify(DEFAULT_POLICY) },
      description:
        "Edge Guard's adjustable thresholds. A malformed field takes its strictest value. The floor (hard rules, unknown tools, egress, fail closed) is not configurable.",
      valueType: "JSON",
    },
    [DOMAINS_PARAM]: {
      defaultValue: { value: JSON.stringify(INTERNAL_DOMAINS) },
      description: "Domains inside the organization. Data sent elsewhere triggers the egress rule.",
      valueType: "JSON",
    },
  },
};

writeFileSync(new URL("../remoteconfig.template.json", import.meta.url), `${JSON.stringify(template, null, 2)}\n`);
console.log("wrote remoteconfig.template.json");
