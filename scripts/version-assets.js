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
  const sourceCorePath = path.join(assetsDir, "app.core.js");
  const sourceCoreText = await fs.readFile(sourceCorePath, "utf8");
  const srcBytes = Buffer.byteLength(sourceCoreText, "utf8");
  const srcHasGetAppState = /export\s+function\s+getAppState\b/.test(sourceCoreText);
  console.log(`[version-assets] app.core srcBytes=${srcBytes}`);
  console.log(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
  if (sourceCoreText.includes("getAppState")) {
    const i = sourceCoreText.indexOf("getAppState");
    console.log(
      `[version-assets] app.core srcAroundGetAppState=${sourceCoreText.slice(
        Math.max(0, i - 80),
        i + 120
      )}`
    );
  }
  const assetFiles = (await fs.readdir(assetsDir)).filter((name) => name.endsWith(".js"));
  const replacements = new Map([
    ["./app.api.js", `./app.api.${buildId}.js`],
    ["./app.core.js", `./app.core.${buildId}.js`],
    ["./app.init.js", `./app.init.${buildId}.js`],
    ["./app.state.js", `./app.state.${buildId}.js`],
    ["./app.ui.js", `./app.ui.${buildId}.js`],
    ["./controllers.js", `./controllers.${buildId}.js`],
    ["./build.js", `./build.${buildId}.js`],
    ["./footer.js", `./footer.${buildId}.js`],
  ]);

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const applyReplacements = (content) => {
    let out = content.replaceAll("__BUILD_ID__", buildId);
    for (const [from, to] of replacements.entries()) {
      const re = new RegExp(`(["'])${escapeRegExp(from)}\\1`, "g");
      out = out.replace(re, `$1${to}$1`);
    }
    return out;
  };

  for (const name of assetFiles) {
    const sourcePath = path.join(assetsDir, name);
    const raw = name === "app.core.js" ? sourceCoreText : await fs.readFile(sourcePath, "utf8");
    const content = applyReplacements(raw);
    const versionedName = name.replace(/\.js$/, `.${buildId}.js`);
    const versionedPath = path.join(assetsDir, versionedName);
    await fs.writeFile(versionedPath, content);
  }

  const appCoreVersioned = path.join(assetsDir, `app.core.${buildId}.js`);
  const appCoreText = await fs.readFile(appCoreVersioned, "utf8");
  const outBytes = Buffer.byteLength(appCoreText, "utf8");
  const outHasExport = appCoreText.includes("export");
  const hasNamedGetAppState =
    /\bexport\s+function\s+getAppState\b/.test(appCoreText) ||
    /\bexport\s+(const|let|var)\s+getAppState\b/.test(appCoreText) ||
    /\bexport\s*\{[^}]*\bgetAppState\b[^}]*\}\s*;?/.test(appCoreText);
  if (!hasNamedGetAppState) {
    console.error(`[version-assets] sourceCorePath=${sourceCorePath}`);
    console.error(`[version-assets] outCorePath=${appCoreVersioned}`);
    console.error(`[version-assets] app.core srcBytes=${srcBytes} outBytes=${outBytes}`);
    console.error(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
    console.error(`[version-assets] app.core outHasExport=${outHasExport}`);
    console.error(`[version-assets] app.core head=${appCoreText.slice(0, 600)}`);
    console.error(`[version-assets] app.core tail=${appCoreText.slice(-200)}`);
    throw new Error(
      `version-assets: generated app.core.${buildId}.js missing named export getAppState`
    );
  }

  const controllersVersioned = path.join(assetsDir, `controllers.${buildId}.js`);
  const controllersContent = await fs.readFile(controllersVersioned, "utf8");
  const hasStaticAppCoreImport = /import\s*\{[^}]*\}\s*from\s*["']\.\/app\.core/.test(
    controllersContent
  );
  if (hasStaticAppCoreImport) {
    throw new Error(
      `version-assets: generated controllers.${buildId}.js contains static named import from app.core`
    );
  }

  const htmlFiles = await walkHtmlFiles(path.join(process.cwd(), "public"));
  await Promise.all(
    htmlFiles.map(async (filePath) => {
      const raw = await fs.readFile(filePath, "utf8");
      let updated = raw.replaceAll("/assets/app.init.js", `/assets/app.init.${buildId}.js`);
      updated = updated.replaceAll("/assets/footer.js", `/assets/footer.${buildId}.js`);
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
