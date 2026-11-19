import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { debugTokensIn, findSecrets, unzip } from "./secretScan";

const TOKEN = "0f8c2b1e-7a3d-4c5e-9b6a-1d2e3f4a5b6c";

/** A minimal zip writer for the tests: stored (0) or deflated (8) entries, no CRC checks needed. */
function zip(entries: { path: string; content: Buffer | string; method?: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, content, method = 8 } of entries) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(path);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const file = (path: string, content: Buffer | string) => ({ path, content: Buffer.isBuffer(content) ? content : Buffer.from(content) });
const bundle = `self.FIREBASE_APPCHECK_DEBUG_TOKEN="${TOKEN}";console.log("ready")`;

describe("findSecrets", () => {
  it("finds the token in a plain file", () => {
    expect(findSecrets([file("background.js", bundle), file("popup.js", "ok")], [TOKEN])).toEqual(["background.js"]);
  });

  it("finds the token inside a deflated zip, where a byte search of the zip would miss it", () => {
    const archive = zip([{ path: "background.js", content: bundle.repeat(20) }]);
    expect(archive.includes(Buffer.from(TOKEN))).toBe(false);
    expect(findSecrets([file("extension/edge-guard-extension.zip", archive)], [TOKEN])).toEqual([
      "extension/edge-guard-extension.zip!background.js",
    ]);
  });

  it("finds it in a stored entry and in a zip inside a zip", () => {
    const inner = zip([{ path: "chunks/app.js", content: bundle, method: 0 }]);
    const outer = zip([
      { path: "readme.txt", content: "nothing here" },
      { path: "inner.zip", content: inner, method: 0 },
    ]);
    expect(findSecrets([file("dist/release.zip", outer)], [TOKEN])).toEqual(["dist/release.zip!inner.zip!chunks/app.js"]);
  });

  it("reports a zip itself when the token is outside every entry", () => {
    const archive = Buffer.concat([zip([{ path: "a.js", content: "fine" }]), Buffer.from(TOKEN)]);
    expect(findSecrets([file("tail.zip", archive)], [TOKEN])).toEqual(["tail.zip"]);
  });

  it("passes a build without the token", () => {
    const archive = zip([{ path: "background.js", content: 'if("")self.FIREBASE_APPCHECK_DEBUG_TOKEN=""' }]);
    expect(findSecrets([file("public.zip", archive), file("index.html", "<html>")], [TOKEN])).toEqual([]);
  });

  it("ignores empty and very short values, which would match by chance", () => {
    expect(findSecrets([file("a.js", "true; abc")], ["", "  ", "true", "abc"])).toEqual([]);
  });

  it("fails closed on a zip it cannot read", () => {
    expect(() => findSecrets([file("broken.zip", "not a zip")], [TOKEN])).toThrow(/Not a zip/);
    const archive = zip([{ path: "a.js", content: bundle, method: 0 }]);
    archive.writeUInt16LE(12, archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // bzip2
    expect(() => findSecrets([file("odd.zip", archive)], [TOKEN])).toThrow(/compression method 12/);
  });

  it("never returns the secret itself", () => {
    const hits = findSecrets([file("background.js", bundle)], [TOKEN]);
    expect(hits.join(" ")).not.toContain(TOKEN);
  });
});

describe("unzip", () => {
  it("reads every entry back", () => {
    const archive = zip([
      { path: "a.txt", content: "alpha", method: 0 },
      { path: "dir/b.txt", content: "bravo".repeat(50) },
    ]);
    expect(unzip(archive).map((f) => [f.path, f.content.toString()])).toEqual([
      ["a.txt", "alpha"],
      ["dir/b.txt", "bravo".repeat(50)],
    ]);
  });
});

describe("debugTokensIn", () => {
  it("reads debug tokens from .env text, quoted or not, and nothing else", () => {
    const env = [
      "VITE_FIREBASE_API_KEY=public-api-key-value",
      `VITE_EXTENSION_APPCHECK_DEBUG_TOKEN="${TOKEN}"`,
      "export OTHER_DEBUG_TOKEN='abcdefgh-1234'",
      "# VITE_OLD_DEBUG_TOKEN=commented-out-value",
      "EMPTY_DEBUG_TOKEN=",
    ].join("\n");
    expect(debugTokensIn(env)).toEqual([TOKEN, "abcdefgh-1234"]);
  });
});
