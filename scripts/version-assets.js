import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execSync } from "child_process";
import crypto from "crypto";
import os from "os";

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
  const publicDir = path.join(process.cwd(), "public");
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const themeCssPath = path.join(publicDir, "theme.css");
  const appCssPath = path.join(assetsDir, "app.css");

  const debugCssFile = (label, filePath) => {
    const resolved = path.resolve(filePath);
    const exists = fsSync.existsSync(filePath);
    const size = exists ? fsSync.statSync(filePath).size : -1;
    const head = exists ? String(fsSync.readFileSync(filePath, "utf8")).slice(0, 120) : "";
    console.log(
      `[version-assets][css-debug] ${label} path=${resolved} exists=${exists} size=${size} head=${JSON.stringify(head)}`
    );
  };

  debugCssFile("theme-source:before-copy", themeCssPath);
  debugCssFile("app-css:before-copy", appCssPath);
  if (!fsSync.existsSync(themeCssPath)) {
    throw new Error(`version-assets: missing theme source ${path.resolve(themeCssPath)}`);
  }
  fsSync.copyFileSync(themeCssPath, appCssPath);
  debugCssFile("app-css:after-copy", appCssPath);

  const copiedCss = String(fsSync.readFileSync(appCssPath, "utf8"));
  const copiedBytes = Buffer.byteLength(copiedCss, "utf8");
  if (copiedBytes < 2000) {
    throw new Error(`version-assets: copied app.css too small (${copiedBytes} bytes)`);
  }
  if (copiedCss.includes("LIVE NEW THEME CANARY")) {
    throw new Error("version-assets: copied app.css contains canary marker");
  }

  let appCssBeforeSha256 = null;
  try {
    const cssBuf = await fs.readFile(appCssPath);
    appCssBeforeSha256 = crypto.createHash("sha256").update(cssBuf).digest("hex");
    const stat = await fs.stat(appCssPath);
    console.log(`[version-assets] app.css bytes=${stat.size}`);
  } catch {
    console.log("[version-assets] app.css bytes=missing");
  }
  const walkFiles = async (dir, out = []) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkFiles(full, out);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  };

  const appCoreCandidates = (await walkFiles(path.join(process.cwd(), "public"))).filter(
    (filePath) => path.basename(filePath).toLowerCase() === "app.core.js"
  );
  if (appCoreCandidates.length !== 1) {
    console.error(`[version-assets] DUPLICATE_APP_CORE count=${appCoreCandidates.length}`);
    appCoreCandidates.forEach((filePath) => console.error(`[version-assets] app.core path=${filePath}`));
    throw new Error("version-assets: DUPLICATE_APP_CORE");
  }

  const sourceCorePath = appCoreCandidates[0];
  const appInitCandidates = (await walkFiles(path.join(process.cwd(), "public"))).filter(
    (filePath) => path.basename(filePath).toLowerCase() === "app.init.js"
  );
  if (appInitCandidates.length !== 1) {
    console.error(`[version-assets] DUPLICATE_APP_INIT count=${appInitCandidates.length}`);
    appInitCandidates.forEach((filePath) => console.error(`[version-assets] app.init path=${filePath}`));
    throw new Error("version-assets: DUPLICATE_APP_INIT");
  }
  const sourceInitPath = appInitCandidates[0];
  const assertModuleSyntax = (label, text) => {
    const tmpPath = path.join(
      os.tmpdir(),
      `livenew-asset-syntax-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.mjs`
    );
    try {
      fsSync.writeFileSync(tmpPath, String(text || ""), "utf8");
      execSync(`node --check "${tmpPath}"`, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const head = String(text || "").slice(0, 600);
      throw new Error(`version-assets: invalid module syntax in ${label}: ${err?.message || err}\nhead=${head}`);
    } finally {
      try {
        fsSync.unlinkSync(tmpPath);
      } catch {
        // ignore temp cleanup errors
      }
    }
  };
  const readSourceCore = async () => {
    const srcBuf = await fs.readFile(sourceCorePath);
    const srcSha256 = crypto.createHash("sha256").update(srcBuf).digest("hex");
    let srcText = srcBuf.toString("utf8");
    const hasBom = srcText.charCodeAt(0) === 0xfeff;
    if (hasBom) srcText = srcText.slice(1);
    return { srcBuf, srcText, srcSha256, hasBom };
  };

  const detectGetAppState = (sourceCoreText) => {
    const hasGetAppState =
      /\bexport\s+function\s+getAppState\b/.test(sourceCoreText) ||
      /\bexport\s*\{\s*getAppState\b/.test(sourceCoreText);
    return hasGetAppState;
  };

  const requiredGetAppStateBlock = [
    "/* REQUIRED: build-time export used by controllers + asset verification */",
    "export function getAppState() {",
    "  try {",
    "    if (typeof window !== \"undefined\" && window.__LN_STATE__) return window.__LN_STATE__;",
    "  } catch {}",
    "  return {};",
    "}",
  ].join("\n");

  const insertGetAppStateAfterImports = (text) => {
    const lines = String(text || "").split(/\r?\n/);
    let idx = 0;
    while (idx < lines.length) {
      const trimmed = lines[idx].trim();
      if (!trimmed) {
        idx += 1;
        continue;
      }
      if (!trimmed.startsWith("import ")) break;
      idx += 1;
      while (idx < lines.length && !lines[idx - 1].includes(";")) {
        idx += 1;
      }
    }
    const patched = [
      ...lines.slice(0, idx),
      "",
      requiredGetAppStateBlock,
      "",
      ...lines.slice(idx),
    ].join("\n");
    return patched;
  };

  let { srcBuf, srcText, srcSha256, hasBom } = await readSourceCore();
  const srcBytes = srcBuf.length;
  let srcHasGetAppState = detectGetAppState(srcText);
  console.log(`[version-assets] app.core srcBytes=${srcBytes}`);
  console.log(`[version-assets] app.core srcSha256=${srcSha256}`);
  console.log(`[version-assets] app.core srcHasBom=${hasBom}`);
  if (!srcHasGetAppState) {
    srcText = insertGetAppStateAfterImports(srcText);
    srcHasGetAppState = detectGetAppState(srcText);
    await fs.writeFile(sourceCorePath, srcText);
    console.log("[version-assets] app.core srcPatched=true");
  }
  console.log(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
  assertModuleSyntax(sourceCorePath, srcText);
  if (!srcHasGetAppState) {
    console.error(`[version-assets] sourceCorePath=${sourceCorePath}`);
    console.error(`[version-assets] app.core srcIndexExport=${srcText.indexOf("export")}`);
    console.error(`[version-assets] app.core srcIndexGetAppState=${srcText.indexOf("getAppState")}`);
    console.error(`[version-assets] app.core srcHead=${srcText.slice(0, 2000)}`);
    throw new Error("version-assets: source app.core.js missing named export getAppState");
  }

  const initBuf = await fs.readFile(sourceInitPath);
  const initSha256 = crypto.createHash("sha256").update(initBuf).digest("hex");
  let initText = initBuf.toString("utf8");
  if (initText.charCodeAt(0) === 0xfeff) initText = initText.slice(1);
  console.log(`[version-assets] sourceInitPath=${path.resolve(sourceInitPath)}`);
  console.log(`[version-assets] app.init srcBytes=${initBuf.length}`);
  console.log(`[version-assets] app.init srcSha256=${initSha256}`);
  console.log(`[version-assets] app.init srcHead=${JSON.stringify(initText.slice(0, 200))}`);

  const sourceAssetNames = [
    "app.api.js",
    "app.core.js",
    "app.init.js",
    "app.state.js",
    "app.ui.js",
    "controllers.js",
    "build.js",
    "footer.js",
  ];
  const assetFiles = [];
  for (const name of sourceAssetNames) {
    if (fsSync.existsSync(path.join(assetsDir, name))) assetFiles.push(name);
  }
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

  const rewriteAppCoreImport = (content) => {
    const pattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*(["'])\.\/app\.core(?:\.[^"']+)?\.js\2\s*;\s*/g;
    return content.replace(pattern, (match, names, quote) => {
      const specMatch = match.match(/(["'])\.\/app\.core(?:\.[^"']+)?\.js\1/);
      const spec = specMatch ? specMatch[0] : `${quote}./app.core.${buildId}.js${quote}`;
      const tmp = "__Core";
      const bindings = names
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const parts = entry.split(/\s+as\s+/).map((part) => part.trim());
          const from = parts[0];
          const to = parts[1] || parts[0];
          return `const ${to} = ${tmp}.${from};`;
        })
        .join("\n");
      return `import * as ${tmp} from ${spec};\n${bindings}\n`;
    });
  };

  for (const name of assetFiles) {
    const sourcePath = path.join(assetsDir, name);
    const raw =
      name === "app.core.js"
        ? srcText
        : name === "app.init.js"
          ? initText
          : await fs.readFile(sourcePath, "utf8");
    let content = applyReplacements(raw);
    if (name === "controllers.js") {
      content = rewriteAppCoreImport(content);
    }
    assertModuleSyntax(sourcePath, content);
    const versionedName = name.replace(/\.js$/, `.${buildId}.js`);
    const versionedPath = path.join(assetsDir, versionedName);
    await fs.writeFile(versionedPath, content);
  }

  const appCoreVersioned = path.join(assetsDir, `app.core.${buildId}.js`);
  const appCoreText = await fs.readFile(appCoreVersioned, "utf8");
  const outBytes = Buffer.byteLength(appCoreText, "utf8");
  const outHasExport = appCoreText.includes("export");
  const outHasGetAppState = detectGetAppState(appCoreText);
  if (!outHasGetAppState) {
    console.error(`[version-assets] sourceCorePath=${sourceCorePath}`);
    console.error(`[version-assets] outCorePath=${appCoreVersioned}`);
    console.error(`[version-assets] app.core srcBytes=${srcBytes} outBytes=${outBytes}`);
    console.error(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
    console.error(`[version-assets] app.core outHasExport=${outHasExport}`);
    console.error(`[version-assets] app.core outHasGetAppState=${outHasGetAppState}`);
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

  // Intentionally avoid mutating HTML/CSS during asset versioning.

  const manifest = {
    buildId,
    generatedAt: new Date().toISOString(),
    files: {
      "app.init": `app.init.${buildId}.js`,
      "app.core": `app.core.${buildId}.js`,
      controllers: `controllers.${buildId}.js`,
      "app.api": `app.api.${buildId}.js`,
      "app.ui": `app.ui.${buildId}.js`,
    },
  };
  const manifestPath = path.join(assetsDir, "build.json");
  const manifestTmp = path.join(assetsDir, `build.${buildId}.tmp.json`);
  await fs.writeFile(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.rename(manifestTmp, manifestPath);
  console.log(`[version-assets] wrote build manifest ${manifestPath}`);

  if (appCssBeforeSha256) {
    const cssAfterBuf = await fs.readFile(appCssPath);
    const appCssAfterSha256 = crypto.createHash("sha256").update(cssAfterBuf).digest("hex");
    if (appCssAfterSha256 !== appCssBeforeSha256) {
      throw new Error("version-assets: app.css was mutated during build; JS versioning must not rewrite CSS");
    }
  }

  console.log(`[version-assets] BUILD_ID=${buildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
