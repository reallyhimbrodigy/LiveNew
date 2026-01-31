import { spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { withOptionalServer } from "./lib/server.js";
import { isRelativeSpecifier } from "./lib/esm-utils.js";

function collectSpecifiers(source) {
  const specifiers = new Set();
  const importRegex = /import\s*(?:[^"']*?\s*from\s*)?["']([^"']+)["']/g;
  const exportFromRegex = /export\s*\{[\s\S]*?\}\s*from\s*["']([^"']+)["']/g;
  const exportAllRegex = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source))) specifiers.add(match[1]);
  while ((match = exportFromRegex.exec(source))) specifiers.add(match[1]);
  while ((match = exportAllRegex.exec(source))) specifiers.add(match[1]);
  return Array.from(specifiers);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return await res.text();
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

function resolveUrl(baseUrl, specifier) {
  return new URL(specifier, baseUrl).toString();
}

function stripLocalExportLists(source) {
  return source.replace(/export\s*\{[\s\S]*?\}\s*;?/g, (match) => {
    return /\bfrom\s*["']/.test(match) ? match : "";
  });
}

async function runSmoke(baseUrl) {
  const errors = [];
  const sourceCache = new Map();
  const visited = new Set();
  const tempDir = path.join(process.cwd(), "data", "temp-modules");
  await fs.mkdir(tempDir, { recursive: true });

  async function getSource(url) {
    if (sourceCache.has(url)) return sourceCache.get(url);
    const text = await fetchText(url);
    sourceCache.set(url, text);
    return text;
  }

  async function checkSyntax(url, source) {
    const fileName = `module-${Math.random().toString(16).slice(2)}.mjs`;
    const filePath = path.join(tempDir, fileName);
    const sanitized = stripLocalExportLists(source);
    await fs.writeFile(filePath, sanitized, "utf8");
    const res = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    await fs.unlink(filePath).catch(() => {});
    if (res.status !== 0) {
      errors.push({ url, message: res.stderr.trim() || res.stdout.trim() || "SyntaxError" });
      return false;
    }
    return true;
  }

  async function visit(url) {
    if (visited.has(url)) return;
    visited.add(url);
    const source = await getSource(url);
    const ok = await checkSyntax(url, source);
    if (!ok) return;

    const specifiers = collectSpecifiers(source);
    for (const specifier of specifiers) {
      if (!isRelativeSpecifier(specifier)) continue;
      const targetUrl = resolveUrl(url, specifier);
      await visit(targetUrl);
    }
  }

  const html = await fetchText(`${baseUrl}/`);
  const scripts = parseModuleScripts(html);
  const moduleUrls = scripts.map((src) => (src.startsWith("http") ? src : `${baseUrl}${src}`));
  for (const url of moduleUrls) {
    await visit(url);
  }

  return { ok: errors.length === 0, errors };
}

async function main() {
  const result = await withOptionalServer(async (baseUrl) => runSmoke(baseUrl));
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, errors: result.errors }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
