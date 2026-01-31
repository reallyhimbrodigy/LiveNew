import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const initPath = path.join(ROOT, "public", "assets", "app.init.js");
  const source = await fs.readFile(initPath, "utf8");

  const hasStaticImport = /import\s+[^;]*from\s*["']\.\/controllers\.js["']/.test(source);
  assert(!hasStaticImport, "app.init.js should not statically import controllers.js");

  const homeIndex = source.indexOf("uiState === \"home\"");
  assert(homeIndex !== -1, "app.init.js should route uiState === \"home\"");

  const loadIndex = source.indexOf("loadControllers", homeIndex);
  assert(loadIndex !== -1, "controllers should be loaded lazily inside home route");

  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
