import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function hashFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return hashContent(raw);
}

export async function verifyHashes({ rootDir, expected, kind }) {
  const mismatches = [];
  for (const [relPath, expectedHash] of Object.entries(expected || {})) {
    const target = path.isAbsolute(relPath) ? relPath : path.join(rootDir, relPath);
    try {
      const actual = await hashFile(target);
      if (actual !== expectedHash) {
        mismatches.push({ path: relPath, expected: expectedHash, actual });
      }
    } catch (err) {
      mismatches.push({ path: relPath, expected: expectedHash, actual: null, error: err?.message || String(err) });
    }
  }
  return { ok: mismatches.length === 0, kind, mismatches };
}
