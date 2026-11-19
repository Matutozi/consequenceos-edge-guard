import { inflateRawSync } from "node:zlib";

/**
 * Finds secrets in files about to be published, including inside zip archives, so a
 * build that carries the App Check debug token cannot reach a public URL by accident.
 * Pure functions; scripts/check-no-secrets.ts runs them on the build folders.
 */
export interface ScannedFile {
  path: string;
  content: Buffer;
}

/** Shorter values match by chance, and no real token is this short. */
export const MIN_SECRET_LENGTH = 8;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

/**
 * The files in a zip archive, read from its central directory. Handles stored and
 * deflated entries, which is everything zip tools write by default. Anything else
 * (ZIP64, other compression) throws: a file this check cannot read must not pass.
 */
export function unzip(archive: Buffer): ScannedFile[] {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || archive.readUInt32LE(eocd) !== EOCD) throw new Error("Not a zip archive.");
  const count = archive.readUInt16LE(eocd + 10);
  let at = archive.readUInt32LE(eocd + 16);
  if (at === ZIP64_MARK) throw new Error("ZIP64 archives are not supported.");

  const files: ScannedFile[] = [];
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(at) !== CENTRAL) throw new Error("The zip's central directory is corrupt.");
    const method = archive.readUInt16LE(at + 10);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const path = archive.toString("utf8", at + 46, at + 46 + nameLength);
    if (size === ZIP64_MARK || local === ZIP64_MARK) throw new Error(`${path}: ZIP64 entries are not supported.`);

    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + size);
    if (method === 0) files.push({ path, content: data });
    else if (method === 8) files.push({ path, content: inflateRawSync(data) });
    else throw new Error(`${path}: compression method ${method} is not supported.`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/**
 * The paths that contain any of the secrets, looking inside zip archives (and zips inside
 * them) too; an entry is reported as "outer.zip!inner/file.js". Never returns the secret.
 */
export function findSecrets(files: ScannedFile[], secrets: string[]): string[] {
  const needles = [...new Set(secrets.map((s) => s.trim()))]
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .map((s) => Buffer.from(s, "utf8"));
  if (needles.length === 0) return [];

  // A zip is reported by the entries that hold the secret; the zip itself only when the
  // secret is outside every entry (for example in its comment).
  const visit = (file: ScannedFile): string[] => {
    const inside = file.path.toLowerCase().endsWith(".zip")
      ? unzip(file.content).flatMap((entry) => visit({ path: `${file.path}!${entry.path}`, content: entry.content }))
      : [];
    if (inside.length > 0) return inside;
    return needles.some((needle) => file.content.includes(needle)) ? [file.path] : [];
  };
  return files.flatMap(visit);
}

/** Values of debug tokens in .env file text: any key whose name contains DEBUG_TOKEN. */
export function debugTokensIn(envText: string): string[] {
  const tokens: string[] = [];
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !match[1].includes("DEBUG_TOKEN")) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (value) tokens.push(value);
  }
  return tokens;
}
