// Regenerates remoteconfig.template.json from the bundled registry.
// Run: npx vite-node scripts/write-remoteconfig-template.ts
import { writeFileSync } from "node:fs";
import { defaultRegistry, INTERNAL_DOMAINS } from "../src/ops/registry";
import { DOMAINS_PARAM, REGISTRY_PARAM } from "../src/ops/registryConfig";

const template = {
  parameters: {
    [REGISTRY_PARAM]: {
      defaultValue: { value: JSON.stringify(defaultRegistry) },
      description:
        "Edge Guard tool registry: sensitivity, reversibility and egress rules per tool. Malformed entries are dropped, which denies those tools.",
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
