import fs from "fs/promises";
import path from "path";
import { withServer } from "./lib/server.js";

const ROOT = process.cwd();

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchHeader(baseUrl, pathname, header) {
  const res = await fetch(`${baseUrl}${pathname}`);
  const value = res.headers.get(header);
  return { res, value };
}

async function run() {
  await withServer({}, async (baseUrl) => {
    const assetsDir = path.join(ROOT, "public", "assets");
    const hash = Math.random().toString(16).slice(2, 12).padEnd(10, "0");
    const hashedName = `cache-test-${hash}.js`;
    const hashedPath = path.join(assetsDir, hashedName);
    await fs.writeFile(hashedPath, "export const cacheTest = true;\n", "utf8");

    try {
      const hashedRes = await fetchHeader(baseUrl, `/assets/${hashedName}`, "cache-control");
      assert(hashedRes.res.ok, "hashed asset should be served");
      assert(
        hashedRes.value && hashedRes.value.includes("max-age=31536000") && hashedRes.value.includes("immutable"),
        `hashed asset cache-control should be long-lived, got: ${hashedRes.value}`
      );

      const moduleRes = await fetchHeader(baseUrl, "/assets/app.core.js", "cache-control");
      assert(moduleRes.res.ok, "app.core.js should be served");
      assert(
        moduleRes.value && moduleRes.value.includes("no-cache"),
        `app.core.js cache-control should be no-cache, got: ${moduleRes.value}`
      );
    } finally {
      await fs.unlink(hashedPath).catch(() => {});
    }
  });

  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
