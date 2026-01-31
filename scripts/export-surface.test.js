import fs from "fs/promises";
import path from "path";
import { parseNamedImports, parseNamedExports } from "./lib/esm-utils.js";

const ROOT = process.cwd();

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const controllersPath = path.join(ROOT, "public", "assets", "controllers.js");
  const corePath = path.join(ROOT, "public", "assets", "app.core.js");

  const controllersSource = await fs.readFile(controllersPath, "utf8");
  const coreSource = await fs.readFile(corePath, "utf8");

  const imports = parseNamedImports(controllersSource);
  const coreImports = imports.filter((entry) => entry.specifier === "./app.core.js");
  assert(coreImports.length > 0, "controllers.js should import from ./app.core.js");

  const { names: coreExports } = parseNamedExports(coreSource);

  const missing = [];
  coreImports.forEach((entry) => {
    entry.names.forEach((name) => {
      if (!coreExports.has(name)) missing.push(name);
    });
  });

  assert(missing.length === 0, `Missing exports in app.core.js: ${missing.join(", ")}`);
  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
