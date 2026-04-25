// One-command ship pipeline.
// 1. Run `eas build --platform ios --profile production`
// 2. Parse the .ipa artifact URL from build output
// 3. Download the .ipa locally
// 4. Upload to App Store Connect via altool (using our own ASC API key)
// 5. Poll until Apple finishes processing
//
// Usage: npm run ship
//
// Requires .secrets/AuthKey_<KEY_ID>.p8 in place. See scripts/asc.mjs for env vars.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_ID = process.env.ASC_APP_ID || "6760437838";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "inherit"], ...opts });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited ${code}`))));
    child.on("error", reject);
  });
}

async function easBuild() {
  console.log("\n[1/4] Building via EAS...\n");
  const out = await run("npx", ["eas", "build", "--platform", "ios", "--profile", "production", "--non-interactive"]);
  const m = out.match(/https:\/\/expo\.dev\/artifacts\/eas\/[A-Za-z0-9]+\.ipa/);
  if (!m) throw new Error("Could not find .ipa artifact URL in EAS output.");
  return m[0];
}

async function download(url, dest) {
  console.log(`\n[2/4] Downloading ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const writer = createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  const total = Number(res.headers.get("content-length") || 0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
    received += value.length;
    if (total) {
      const pct = ((received / total) * 100).toFixed(1);
      process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`);
    }
  }
  writer.end();
  await new Promise((r) => writer.on("finish", r));
  console.log(`\n  saved to ${dest}`);
}

async function upload(ipaPath) {
  console.log("\n[3/4] Uploading to App Store Connect via altool...\n");
  await run("node", ["scripts/asc.mjs", "upload", ipaPath]);
}

async function pollProcessing() {
  console.log("\n[4/4] Polling Apple every 30s for processing completion (max 30 min)...\n");
  const deadline = Date.now() + 30 * 60 * 1000;
  let lastSeen = null;
  while (Date.now() < deadline) {
    const r = spawnSync("node", ["scripts/asc.mjs", "builds"], { encoding: "utf8" });
    const top = (r.stdout.split("\n").find((l) => /^\d+\s+1\.0\./.test(l)) || "").trim();
    if (top !== lastSeen) {
      console.log(`  ${new Date().toLocaleTimeString()}  ${top}`);
      lastSeen = top;
    }
    if (top.includes("VALID") && top.includes("READY_FOR_BETA_SUBMISSION")) {
      console.log("\n✅ Build is in TestFlight. Done.");
      return;
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
  console.log("\n⚠️  Polling timed out at 30 min. Run `node scripts/asc.mjs builds` to check.");
}

(async () => {
  try {
    const artifactUrl = await easBuild();
    const dir = path.join(tmpdir(), "livenew-ship");
    mkdirSync(dir, { recursive: true });
    const ipaPath = path.join(dir, `LiveNew-${Date.now()}.ipa`);
    await download(artifactUrl, ipaPath);
    await upload(ipaPath);
    await pollProcessing();
  } catch (err) {
    console.error("\n❌ Ship failed:", err.message);
    process.exit(1);
  }
})();
