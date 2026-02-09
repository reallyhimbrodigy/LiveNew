import fs from "fs";
import fsp from "fs/promises";
import path from "path";

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const assetsDir = path.join(process.cwd(), "public", "assets");
  const manifestPath = path.join(assetsDir, "build.json");
  if (!(await fileExists(manifestPath))) {
    console.error("verify-assets: missing build manifest public/assets/build.json");
    process.exit(2);
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  const buildId = (manifest?.buildId || "").trim();
  if (!buildId) {
    console.error("verify-assets: build.json missing buildId");
    process.exit(2);
  }
  const files = manifest?.files || {};
  for (const [key, fileName] of Object.entries(files)) {
    const filePath = path.join(assetsDir, fileName);
    if (!(await fileExists(filePath))) {
      console.error(`verify-assets: missing ${key} at ${filePath}`);
      process.exit(1);
    }
  }

  const appCssPath = path.join(assetsDir, "app.css");
  if (!(await fileExists(appCssPath))) {
    console.error("verify-assets: missing public/assets/app.css");
    process.exit(1);
  }
  const cssResolved = path.resolve(appCssPath);
  const cssExists = fs.existsSync(appCssPath);
  const cssSize = cssExists ? fs.statSync(appCssPath).size : -1;
  const cssHead = cssExists ? String(fs.readFileSync(appCssPath, "utf8")).slice(0, 120) : "";
  console.log(
    `[verify-assets][css-debug] path=${cssResolved} exists=${cssExists} size=${cssSize} head=${JSON.stringify(cssHead)}`
  );
  const cssText = await fsp.readFile(appCssPath, "utf8");
  const cssBytes = Buffer.byteLength(cssText, "utf8");
  if (cssBytes < 2000) {
    console.error(
      `verify-assets: app.css too small (${cssBytes} bytes) path=${cssResolved} head=${JSON.stringify(cssText.slice(0, 80))}`
    );
    process.exit(1);
  }
  if (cssText.includes("LIVE NEW THEME CANARY")) {
    console.error(
      `verify-assets: app.css contains canary marker path=${cssResolved} bytes=${cssBytes} head=${JSON.stringify(cssText.slice(0, 80))}`
    );
    process.exit(1);
  }

  const appCoreFile = files["app.core"];
  if (!appCoreFile) {
    console.error("verify-assets: build.json missing files.app.core");
    process.exit(2);
  }
  const sourceInitPath = path.join(assetsDir, "app.init.js");
  const sourceInitText = await fsp.readFile(sourceInitPath, "utf8");
  if (!/import\s*\{\s*bootstrapApp\s*\}\s*from\s*["']\.\/app\.core\.js["']/.test(sourceInitText)) {
    throw new Error(`verify-assets: source app.init.js must import only bootstrapApp from ./app.core.js at ${sourceInitPath}`);
  }
  if (!/\bbootstrapApp\s*\(\s*\)\s*;?/.test(sourceInitText)) {
    throw new Error(`verify-assets: source app.init.js must call bootstrapApp() at ${sourceInitPath}`);
  }
  const forbiddenInitTokens = [
    "bindAuth",
    "initBaseUi",
    "updateAdminVisibility",
    "getAppState",
    "routeError",
    "setupConsentGate",
  ];
  const forbiddenInSourceInit = forbiddenInitTokens.filter((token) => sourceInitText.includes(token));
  if (forbiddenInSourceInit.length) {
    throw new Error(
      `verify-assets: source app.init.js contains forbidden legacy tokens [${forbiddenInSourceInit.join(", ")}] at ${sourceInitPath}`
    );
  }
  const sourceCorePath = path.join(assetsDir, "app.core.js");
  const sourceCoreText = await fsp.readFile(sourceCorePath, "utf8");
  if (!/export\s+function\s+getAppState\b/m.test(sourceCoreText)) {
    throw new Error(
      `verify-assets: source app.core.js missing literal 'export function getAppState' at ${sourceCorePath}`
    );
  }
  const appCorePath = path.join(assetsDir, appCoreFile);
  const text = await fsp.readFile(appCorePath, "utf8");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (!/^\s*import\b/.test(firstLine)) {
    throw new Error(`verify-assets: ${appCoreFile} must begin with a top-level import statement`);
  }
  if (/import\s*\{\s*\n\s*export\s+function\s+getAppState\b/m.test(text)) {
    throw new Error(`verify-assets: ${appCoreFile} has corrupted import/export sequence (import { followed by export function)`);
  }
  const hasNamedGetAppState =
    /export\s+function\s+getAppState\b/m.test(text) ||
    /export\s+(const|let|var)\s+getAppState\b/m.test(text) ||
    /export\s*\{[\s\S]*?\bgetAppState\b[\s\S]*?\}/m.test(text) ||
    /export\s*\{[\s\S]*?\bgetAppState\s+as\s+getAppState\b[\s\S]*?\}/m.test(text) ||
    /export\s*\{[\s\S]*?\bgetAppStateInternal\s+as\s+getAppState\b[\s\S]*?\}/m.test(text);
  if (!hasNamedGetAppState) {
    const head = text.slice(0, 600);
    const tail = text.slice(-200);
    throw new Error(
      `verify-assets: ${appCoreFile} missing export getAppState\nhead=${head}\ntail=${tail}`
    );
  }

  const appInitFile = files["app.init"] || `app.init.${buildId}.js`;
  const appInitPath = path.join(assetsDir, appInitFile);
  if (!(await fileExists(appInitPath))) {
    throw new Error(`verify-assets: missing app.init at ${appInitPath}`);
  }
  const appInitText = await fsp.readFile(appInitPath, "utf8");
  const coreImportMatch = appInitText.match(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']\.\/app\.core(?:\.[^"']+)?\.js["']\s*;?/m
  );
  if (coreImportMatch) {
    const importedNames = coreImportMatch[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+as\s+/).map((part) => part.trim());
        return parts[0];
      });
    if (importedNames.length !== 1 || importedNames[0] !== "bootstrapApp") {
      throw new Error(
        `verify-assets: ${appInitFile} must import only bootstrapApp from ${appCoreFile}; found [${importedNames.join(", ")}]`
      );
    }
    const hasBootstrapAppExport =
      /\bexport\s+(async\s+)?function\s+bootstrapApp\b/m.test(text) ||
      /\bexport\s*\{[\s\S]*?\bbootstrapApp\b[\s\S]*?\}/m.test(text);
    if (!hasBootstrapAppExport) {
      throw new Error(
        `verify-assets: ${appInitFile} imports bootstrapApp from ${appCoreFile} but ${appCoreFile} does not export it`
      );
    }
  } else {
    throw new Error(`verify-assets: ${appInitFile} must import bootstrapApp from ${appCoreFile}`);
  }

  const controllersFile = files["controllers"];
  if (controllersFile) {
    const controllersPath = path.join(assetsDir, controllersFile);
    const controllersText = await fsp.readFile(controllersPath, "utf8");
    const hasStaticNamedImport = /import\s*\{\s*[^}]+\s*\}\s*from\s*["']\.\/app\.core(?:\.[^"']+)?\.js["']/.test(
      controllersText
    );
    if (hasStaticNamedImport) {
      throw new Error(
        `verify-assets: ${controllersFile} contains static named import from app.core`
      );
    }
  }

  console.log(`verify-assets: OK buildId=${buildId}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
