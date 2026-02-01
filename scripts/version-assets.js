import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

function utcTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join("");
}

function resolveBuildId() {
  const env = (process.env.BUILD_ID || "").trim();
  if (env) return env;
  const stamp = utcTimestamp();
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (sha) return `${stamp}-${sha}`;
  } catch {
    // ignore git failures
  }
  return stamp;
}

async function walkHtmlFiles(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkHtmlFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const buildId = resolveBuildId();
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const assetFiles = (await fs.readdir(assetsDir)).filter((name) => name.endsWith(".js"));
  const replacements = new Map([
    ["./app.api.js", `./app.api.${buildId}.js`],
    ["./app.core.js", `./app.core.${buildId}.js`],
    ["./app.init.js", `./app.init.${buildId}.js`],
    ["./app.state.js", `./app.state.${buildId}.js`],
    ["./app.ui.js", `./app.ui.${buildId}.js`],
    ["./controllers.js", `./controllers.${buildId}.js`],
    ["./build.js", `./build.${buildId}.js`],
  ]);

  await Promise.all(
    assetFiles.map(async (name) => {
      const sourcePath = path.join(assetsDir, name);
      const raw = await fs.readFile(sourcePath, "utf8");
      let content = raw.replaceAll("__BUILD_ID__", buildId);
      for (const [from, to] of replacements.entries()) {
        content = content.split(from).join(to);
      }
      const versionedName = name.replace(/\.js$/, `.${buildId}.js`);
      const versionedPath = path.join(assetsDir, versionedName);
      await fs.writeFile(versionedPath, content);
    })
  );

  const appCoreVersioned = path.join(assetsDir, `app.core.${buildId}.js`);
  const appCoreContent = await fs.readFile(appCoreVersioned, "utf8");
  const hasGetAppStateExport =
    appCoreContent.includes("export function getAppState") ||
    appCoreContent.includes("export { getAppState");
  if (!hasGetAppStateExport) {
    throw new Error(
      `version-assets: generated app.core.${buildId}.js missing named export getAppState`
    );
  }

  const htmlFiles = await walkHtmlFiles(path.join(process.cwd(), "public"));
  await Promise.all(
    htmlFiles.map(async (filePath) => {
      const raw = await fs.readFile(filePath, "utf8");
      const updated = raw.replaceAll("/assets/app.init.js", `/assets/app.init.${buildId}.js`);
      if (updated !== raw) {
        await fs.writeFile(filePath, updated);
      }
    })
  );

  console.log(`[version-assets] BUILD_ID=${buildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
