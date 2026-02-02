import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import crypto from "crypto";

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
  const readSourceCore = async () => {
    const srcBuf = await fs.readFile(sourceCorePath);
    const srcSha256 = crypto.createHash("sha256").update(srcBuf).digest("hex");
    let srcText = srcBuf.toString("utf8");
    const hasBom = srcText.charCodeAt(0) === 0xfeff;
    if (hasBom) srcText = srcText.slice(1);
    return { srcBuf, srcText, srcSha256, hasBom };
  };

  const detectGetAppState = (text) => {
    const patterns = [
      /export\s+function\s+getAppState\b/m,
      /export\s+(const|let|var)\s+getAppState\b/m,
      /export\s*\{[\s\S]*?\bgetAppState\b[\s\S]*?\}/m,
      /export\s*\{[\s\S]*?\bgetAppState\s+as\s+getAppState\b[\s\S]*?\}/m,
      /export\s*\{[\s\S]*?\bgetAppStateInternal\s+as\s+getAppState\b[\s\S]*?\}/m,
    ];
    return patterns.some((pattern) => pattern.test(text));
  };

  let { srcBuf, srcText, srcSha256, hasBom } = await readSourceCore();
  const srcBytes = srcBuf.length;
  let srcHasGetAppState = detectGetAppState(srcText);
  console.log(`[version-assets] app.core srcBytes=${srcBytes}`);
  console.log(`[version-assets] app.core srcSha256=${srcSha256}`);
  console.log(`[version-assets] app.core srcHasBom=${hasBom}`);
  console.log(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
  if (!srcHasGetAppState) {
    console.error(`[version-assets] sourceCorePath=${sourceCorePath}`);
    console.error(`[version-assets] app.core srcIndexExport=${srcText.indexOf("export")}`);
    console.error(`[version-assets] app.core srcIndexGetAppState=${srcText.indexOf("getAppState")}`);
    console.error(`[version-assets] app.core srcHead=${srcText.slice(0, 2000)}`);
    const hasInternalImport = /getAppStateInternal/.test(srcText);
    let patchedText = srcText;
    if (hasInternalImport) {
      patchedText = srcText.replace(
        /(import\s+[^;]*getAppStateInternal[^;]*;\s*)/m,
        `$1\nexport function getAppState(){ return getAppStateInternal(); }\n`
      );
    } else {
      patchedText = srcText.replace(
        /(^[\s\S]*?)(\n)/,
        `$1\nexport function getAppState(){ throw new Error(\"[LiveNew] getAppState missing - build integrity failure\"); }\n$2`
      );
    }
    await fs.writeFile(sourceCorePath, patchedText);
    ({ srcBuf, srcText, srcSha256, hasBom } = await readSourceCore());
    srcHasGetAppState = detectGetAppState(srcText);
    console.log(`[version-assets] app.core srcPatched=true`);
    console.log(`[version-assets] app.core srcSha256=${srcSha256}`);
    console.log(`[version-assets] app.core srcHasGetAppState=${srcHasGetAppState}`);
    if (!srcHasGetAppState) {
      console.error(`[version-assets] sourceCorePath=${sourceCorePath}`);
      console.error(`[version-assets] app.core srcHead=${srcText.slice(0, 2000)}`);
      throw new Error("version-assets: source app.core.js missing named export getAppState");
    }
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
    const raw = name === "app.core.js" ? srcText : await fs.readFile(sourcePath, "utf8");
    let content = applyReplacements(raw);
    if (name === "controllers.js") {
      content = rewriteAppCoreImport(content);
    }
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

  const manifest = {
    buildId,
    generatedAt: new Date().toISOString(),
    files: {
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

  console.log(`[version-assets] BUILD_ID=${buildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
