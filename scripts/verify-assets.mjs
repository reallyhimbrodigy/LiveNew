import fs from "fs/promises";
import path from "path";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBuildId() {
  const envId = (process.env.BUILD_ID || "").trim();
  if (envId) return envId;
  const indexPath = path.join(process.cwd(), "public", "index.html");
  if (await fileExists(indexPath)) {
    const html = await fs.readFile(indexPath, "utf8");
    const match = html.match(/\/assets\/app\.init\.([A-Za-z0-9._-]+)\.js/);
    if (match) return match[1];
  }
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const entries = (await fs.readdir(assetsDir)).filter((name) => name.startsWith("app.core."));
  if (!entries.length) return "";
  const sorted = entries.sort((a, b) => a.localeCompare(b));
  const latest = sorted[sorted.length - 1];
  const match = latest.match(/^app\.core\.(.+)\.js$/);
  return match ? match[1] : "";
}

async function main() {
  const buildId = await resolveBuildId();
  if (!buildId) {
    console.error("verify-assets: unable to determine BUILD_ID");
    process.exit(2);
  }
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const appCorePath = path.join(assetsDir, `app.core.${buildId}.js`);
  if (!(await fileExists(appCorePath))) {
    console.error(`verify-assets: missing ${appCorePath}`);
    process.exit(1);
  }
  const text = await fs.readFile(appCorePath, "utf8");
  const hasNamedGetAppState =
    /\bexport\s+function\s+getAppState\b/.test(text) ||
    /\bexport\s+(const|let|var)\s+getAppState\b/.test(text) ||
    /\bexport\s*\{[^}]*\bgetAppState\b[^}]*\}\s*;?/.test(text);
  if (!hasNamedGetAppState) {
    throw new Error(
      `verify-assets: app.core.${buildId}.js missing export getAppState`
    );
  }
  console.log(`verify-assets: OK app.core.${buildId}.js exports getAppState`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
