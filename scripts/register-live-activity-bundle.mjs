// Register the LiveActivity extension's bundle ID on Apple's side so that
// EAS Build's non-interactive credential setup can auto-provision a profile
// for it. Without this, the build fails with "Distribution Certificate is
// not validated for non-interactive builds" on the new target.
//
// Same dance we did for the main bundle ID + widget. Idempotent — re-running
// is safe.

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const KEY_ID = process.env.EXPO_ASC_KEY_ID || process.env.ASC_KEY_ID || "6UXQ2STG2D";
const ISSUER_ID = process.env.EXPO_ASC_ISSUER_ID || process.env.ASC_ISSUER_ID || "64bc4b23-6b09-469c-967c-8a87a619dacb";
const KEY_PATH = process.env.EXPO_ASC_API_KEY_PATH || process.env.ASC_KEY_PATH || `.secrets/AuthKey_${KEY_ID}.p8`;
const NEW_BUNDLE_ID = "app.livenew.mobile.LiveActivity";
const NEW_BUNDLE_NAME = "LiveNew LiveActivity";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt() {
  if (!existsSync(KEY_PATH)) throw new Error(`ASC private key not found at ${KEY_PATH}.`);
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

async function asc(method, pathAndQuery, body) {
  const url = `https://api.appstoreconnect.apple.com/v1${pathAndQuery}`;
  const opts = {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, text, body: parsed };
}

(async () => {
  try {
    // Check if it already exists
    const existing = await asc(
      "GET",
      `/bundleIds?filter[identifier]=${encodeURIComponent(NEW_BUNDLE_ID)}&limit=1`,
    );
    if (existing.body?.data?.[0]) {
      console.log(`✓ Bundle ID already exists: ${NEW_BUNDLE_ID} (${existing.body.data[0].id})`);
      return;
    }

    // Create it
    const create = await asc("POST", "/bundleIds", {
      data: {
        type: "bundleIds",
        attributes: {
          identifier: NEW_BUNDLE_ID,
          name: NEW_BUNDLE_NAME,
          platform: "IOS",
        },
      },
    });
    if (!create.ok) throw new Error(`Create failed: ${create.status}\n${create.text}`);
    console.log(`✓ Created bundle ID: ${NEW_BUNDLE_ID} (${create.body?.data?.id})`);
    console.log("\nEAS Build should now be able to auto-provision a profile for this target on the next ship.");
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  }
})();
