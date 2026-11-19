// Fails when a folder about to be published holds an App Check debug token, in any file or
// inside any zip. The release scripts and Firebase's hosting predeploy run it, so a build with
// the token cannot be deployed by accident.
// Run: npx vite-node scripts/check-no-secrets.ts <folder>...
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { debugTokensIn, findSecrets, type ScannedFile } from "./secretScan";

const root = fileURLToPath(new URL("..", import.meta.url));
const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error("Usage: vite-node scripts/check-no-secrets.ts <folder>...");
  process.exit(2);
}

// Read the .env files directly: the public build blanks the token in its own environment,
// and that must not blank it here too.
const secrets = [".env", ".env.local", ".env.production", ".env.production.local"]
  .map((name) => join(root, name))
  .filter(existsSync)
  .flatMap((file) => debugTokensIn(readFileSync(file, "utf8")));
for (const [key, value] of Object.entries(process.env)) {
  if (key.includes("DEBUG_TOKEN") && value) secrets.push(value);
}

if (secrets.length === 0) {
  console.log("No App Check debug token is configured, so there is nothing to leak.");
  process.exit(0);
}

function walk(folder: string): ScannedFile[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [{ path: relative(root, path), content: readFileSync(path) }];
  });
}

let failed = false;
for (const folder of folders) {
  const path = resolve(root, folder);
  if (!existsSync(path)) {
    console.error(`${folder} does not exist. Build it first.`);
    failed = true;
    continue;
  }
  const hits = findSecrets(walk(path), secrets);
  if (hits.length > 0) {
    failed = true;
    console.error(`An App Check debug token is in ${folder}, which is about to be published:`);
    for (const hit of hits) console.error(`  ${hit}`);
  } else {
    console.log(`${folder}: no App Check debug token.`);
  }
}
if (failed) {
  console.error(
    "Not publishing. Build the public extension without the token (npm run release:extension), " +
      "and share the build with the token (npm run zip:extension) with judges privately.",
  );
  process.exit(1);
}
