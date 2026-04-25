// Direct App Store Connect API client.
// Bypasses EAS Submit. Uses our own .p8 key in .secrets/.
//
// Usage:
//   node scripts/asc.mjs builds              List recent iOS builds + state
//   node scripts/asc.mjs build <buildNumber> Detail for a specific build number
//   node scripts/asc.mjs upload <ipaPath>    Upload .ipa via altool
//
// Env vars (with defaults):
//   ASC_KEY_ID       6UXQ2STG2D
//   ASC_ISSUER_ID    64bc4b23-6b09-469c-967c-8a87a619dacb
//   ASC_KEY_PATH     .secrets/AuthKey_<KEY_ID>.p8
//   ASC_APP_ID       6744594498

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const KEY_ID = process.env.ASC_KEY_ID || "6UXQ2STG2D";
const ISSUER_ID = process.env.ASC_ISSUER_ID || "64bc4b23-6b09-469c-967c-8a87a619dacb";
const APP_ID = process.env.ASC_APP_ID || "6760437838";
const KEY_PATH = process.env.ASC_KEY_PATH || `.secrets/AuthKey_${KEY_ID}.p8`;

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt() {
  if (!existsSync(KEY_PATH)) {
    throw new Error(`ASC private key not found at ${KEY_PATH}. Drop AuthKey_${KEY_ID}.p8 there.`);
  }
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(readFileSync(KEY_PATH));
  const signer = createSign("SHA256");
  signer.update(data);
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

async function asc(pathAndQuery) {
  const url = `https://api.appstoreconnect.apple.com/v1${pathAndQuery}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt()}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ASC ${res.status} ${res.statusText} on ${pathAndQuery}\n${text}`);
  }
  return JSON.parse(text);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function listBuilds() {
  const r = await asc(
    `/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=15&include=buildBetaDetail,preReleaseVersion`,
  );
  const detailById = new Map();
  const versionById = new Map();
  for (const inc of r.included || []) {
    if (inc.type === "buildBetaDetails") detailById.set(inc.id, inc.attributes || {});
    if (inc.type === "preReleaseVersions") versionById.set(inc.id, inc.attributes || {});
  }
  console.log(`\nLast ${r.data.length} iOS builds for app ${APP_ID}:\n`);
  console.log(
    "build  version  uploaded            processing  internal      external          expires".padEnd(80),
  );
  console.log("-".repeat(110));
  for (const b of r.data) {
    const a = b.attributes || {};
    const detailRel = b.relationships?.buildBetaDetail?.data;
    const versionRel = b.relationships?.preReleaseVersion?.data;
    const detail = detailRel ? detailById.get(detailRel.id) || {} : {};
    const version = versionRel ? versionById.get(versionRel.id) || {} : {};
    const buildNum = a.version || "?";
    const versionStr = version.version || "?";
    const processed = a.processingState || "?";
    const internal = detail.internalBuildState || "—";
    const external = detail.externalBuildState || "—";
    const uploaded = fmtDate(a.uploadedDate);
    const expires = fmtDate(a.expirationDate);
    console.log(
      `${buildNum.padEnd(6)} ${versionStr.padEnd(8)} ${uploaded.padEnd(20)} ${processed.padEnd(11)} ${internal.padEnd(13)} ${external.padEnd(17)} ${expires}`,
    );
  }
  console.log("");
}

async function buildDetail(buildNumber) {
  const r = await asc(
    `/builds?filter[app]=${APP_ID}&filter[version]=${buildNumber}&include=buildBetaDetail,preReleaseVersion,betaBuildLocalizations`,
  );
  if (!r.data.length) {
    console.log(`No build with number ${buildNumber} found.`);
    return;
  }
  for (const b of r.data) {
    console.log(JSON.stringify({ build: b, included: r.included }, null, 2));
  }
}

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on("error", reject);
  });
}

async function upload(ipaPath) {
  if (!ipaPath) throw new Error("Provide an .ipa path");
  if (!existsSync(ipaPath)) throw new Error(`File not found: ${ipaPath}`);
  const absKey = path.resolve(KEY_PATH);
  const absIpa = path.resolve(ipaPath);
  console.log(`Uploading ${absIpa} to App Store Connect...`);
  await run(
    "xcrun",
    [
      "altool",
      "--upload-app",
      "-f",
      absIpa,
      "-t",
      "ios",
      "--apiKey",
      KEY_ID,
      "--apiIssuer",
      ISSUER_ID,
      "--show-progress",
    ],
    { API_PRIVATE_KEYS_DIR: path.dirname(absKey) },
  );
  console.log("\nUpload complete. Apple will now process the build (5–30 min). Run `node scripts/asc.mjs builds` to watch.");
}

const [, , cmd, arg] = process.argv;

try {
  if (cmd === "builds") await listBuilds();
  else if (cmd === "build") await buildDetail(arg);
  else if (cmd === "upload") await upload(arg);
  else {
    console.log("Usage: node scripts/asc.mjs <builds|build <number>|upload <ipa>>");
    process.exit(1);
  }
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}
