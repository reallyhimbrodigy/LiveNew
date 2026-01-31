// Runbook: set EXPECTED_STATIC_ROOT and optional STATIC_ROOT_ALLOWLIST.
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const EXPECTED_ROOT = (process.env.EXPECTED_STATIC_ROOT || "public").trim();
const ALLOWLIST = (process.env.STATIC_ROOT_ALLOWLIST || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const RELEVANT_ROOTS = new Set(["public", "dist", "build", "static", "assets", "src"]);
const TARGET_FILES = ["controllers.js", "app.core.js", "app.init.js"];

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function walk(dir, out) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "data") continue;
      await walk(next, out);
    } else if (entry.isFile()) {
      if (TARGET_FILES.includes(entry.name)) out.push(next);
    }
  }
}

async function run() {
  assert(EXPECTED_ROOT, "EXPECTED_STATIC_ROOT is required");
  const found = [];
  await walk(ROOT, found);

  const grouped = new Map();
  for (const filePath of found) {
    const rel = path.relative(ROOT, filePath);
    const root = rel.split(path.sep)[0];
    if (!RELEVANT_ROOTS.has(root)) continue;
    const name = path.basename(filePath);
    if (!grouped.has(name)) grouped.set(name, new Map());
    const byRoot = grouped.get(name);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(rel);
  }

  const conflicts = [];
  const missing = [];
  const foundNames = new Set(grouped.keys());
  TARGET_FILES.forEach((name) => {
    if (!foundNames.has(name)) {
      missing.push({ file: name, expectedRoot: EXPECTED_ROOT, foundRoots: [] });
    }
  });
  for (const [name, byRoot] of grouped.entries()) {
    const roots = Array.from(byRoot.keys());
    const allowedRoots = new Set([EXPECTED_ROOT, ...ALLOWLIST]);
    const unexpected = roots.filter((root) => !allowedRoots.has(root));
    if (!roots.includes(EXPECTED_ROOT)) {
      missing.push({ file: name, expectedRoot: EXPECTED_ROOT, foundRoots: roots });
    }
    if (unexpected.length) {
      conflicts.push({ file: name, expectedRoot: EXPECTED_ROOT, unexpectedRoots: unexpected, paths: Array.from(byRoot.values()).flat() });
    }
  }

  const ok = conflicts.length === 0 && missing.length === 0;
  const output = { ok, expectedRoot: EXPECTED_ROOT, allowlist: ALLOWLIST, conflicts, missing };
  if (!ok) {
    console.error(JSON.stringify(output, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(output, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
