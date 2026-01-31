import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { withOptionalServer } from "./lib/server.js";
import { parseNamedImports, parseNamedExports, isRelativeSpecifier } from "./lib/esm-utils.js";

const ROOT = process.cwd();
const STATIC_ROOT = process.env.STATIC_ROOT || "public";
const STATIC_ROOTS = (process.env.STATIC_ROOTS || "public,dist,build,static,assets")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .filter((entry) => entry && entry !== "." && entry !== "..")
  .filter((entry, index, arr) => arr.indexOf(entry) === index);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return await res.text();
}

function resolveUrl(baseUrl, specifier) {
  return new URL(specifier, baseUrl).toString();
}

function parseModuleScripts(html) {
  const scripts = [];
  const regex = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    scripts.push(match[1]);
  }
  return scripts;
}

function detectShadowedPaths(urlPath) {
  const candidates = [];
  STATIC_ROOTS.forEach((root) => {
    const rootPath = path.join(ROOT, root);
    const filePath = path.join(rootPath, urlPath.replace(/^\//, ""));
    candidates.push({ root, filePath });
  });
  return candidates.filter((entry) => existsSync(entry.filePath));
}

async function readLocalIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function verifyStaticEsm(baseUrl) {
  const issues = [];
  const warnings = [];
  const sourceCache = new Map();
  const exportCache = new Map();
  const visiting = new Set();
  const visited = new Set();

  async function getSource(url) {
    if (sourceCache.has(url)) return sourceCache.get(url);
    const text = await fetchText(url);
    sourceCache.set(url, text);
    return text;
  }

  async function getExports(url) {
    if (exportCache.has(url)) return exportCache.get(url);
    if (visiting.has(url)) return new Set();
    visiting.add(url);
    const source = await getSource(url);
    const { names, reexports, exportAll } = parseNamedExports(source);
    for (const entry of reexports) {
      if (!isRelativeSpecifier(entry.specifier)) {
        continue;
      }
      const targetUrl = resolveUrl(url, entry.specifier);
      const targetExports = await getExports(targetUrl);
      entry.specifiers.forEach((spec) => {
        const local = spec.local;
        if (local === "default" || local === "*") return;
        if (!targetExports.has(local)) {
          issues.push({
            type: "missing_reexport",
            url,
            targetUrl,
            name: local,
          });
        }
      });
    }
    for (const specifier of exportAll) {
      if (!isRelativeSpecifier(specifier)) continue;
      const targetUrl = resolveUrl(url, specifier);
      const targetExports = await getExports(targetUrl);
      targetExports.forEach((name) => names.add(name));
    }
    exportCache.set(url, names);
    visiting.delete(url);
    return names;
  }

  async function verifyModule(url, chain = []) {
    if (visited.has(url)) return;
    visited.add(url);

    const urlObj = new URL(url);
    const urlPath = urlObj.pathname;
    const shadowCandidates = detectShadowedPaths(urlPath);
    if (shadowCandidates.length > 1) {
      issues.push({
        type: "shadowed_static_root",
        url,
        candidates: shadowCandidates.map((entry) => entry.filePath),
      });
    }

    const expectedLocal = path.join(ROOT, STATIC_ROOT, urlPath.replace(/^\//, ""));
    if (existsSync(expectedLocal)) {
      const localSource = await readLocalIfExists(expectedLocal);
      const remoteSource = await getSource(url);
      if (localSource != null && localSource !== remoteSource) {
        issues.push({
          type: "served_content_mismatch",
          url,
          localPath: expectedLocal,
        });
      }
    } else if (shadowCandidates.length === 0) {
      warnings.push({ type: "no_local_static_match", url, localPath: expectedLocal });
    }

    const source = await getSource(url);
    const imports = parseNamedImports(source);
    for (const entry of imports) {
      if (!isRelativeSpecifier(entry.specifier)) continue;
      const targetUrl = resolveUrl(url, entry.specifier);
      const targetExports = await getExports(targetUrl);
      entry.names.forEach((name) => {
        if (!targetExports.has(name)) {
          issues.push({
            type: "missing_export",
            importer: url,
            target: targetUrl,
            name,
            chain: [...chain, url],
          });
        }
      });
      await verifyModule(targetUrl, [...chain, url]);
    }
  }

  const roots = new Set(["/assets/controllers.js", "/assets/app.core.js"]);
  const homeHtml = await fetchText(`${baseUrl}/`);
  const moduleScripts = parseModuleScripts(homeHtml);
  moduleScripts.forEach((src) => roots.add(src.startsWith("http") ? new URL(src).pathname : src));

  const urls = Array.from(roots).map((src) => (src.startsWith("http") ? src : `${baseUrl}${src}`));
  for (const url of urls) {
    await verifyModule(url, []);
  }

  return { ok: issues.length === 0, issues, warnings, urls };
}

async function main() {
  const result = await withOptionalServer(async (baseUrl) => verifyStaticEsm(baseUrl));
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, urls: result.urls, warnings: result.warnings }, null, 2));
    return;
  }
  console.error(JSON.stringify({ ok: false, issues: result.issues, warnings: result.warnings }, null, 2));
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exit(1);
  });
}

export { verifyStaticEsm };
