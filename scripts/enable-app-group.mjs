// Enable the APP_GROUPS capability on our iOS bundle ID and create + attach
// the App Group `group.app.livenew.mobile`, which the home-screen widget needs.
//
// Apple gates App Group capability behind a manual step on the developer
// portal. EAS Build can't enable it automatically, so we hit the App Store
// Connect API directly with our own .p8 key — same pattern we used earlier
// for HealthKit.
//
// Usage:
//   EXPO_ASC_API_KEY_PATH=.secrets/AuthKey_6UXQ2STG2D.p8 \
//   EXPO_ASC_KEY_ID=6UXQ2STG2D \
//   EXPO_ASC_ISSUER_ID=64bc4b23-6b09-469c-967c-8a87a619dacb \
//   node scripts/enable-app-group.mjs
//
// Idempotent: if the capability is already enabled or the group already
// exists, the script reports that and continues.

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const KEY_ID = process.env.EXPO_ASC_KEY_ID || process.env.ASC_KEY_ID || "6UXQ2STG2D";
const ISSUER_ID = process.env.EXPO_ASC_ISSUER_ID || process.env.ASC_ISSUER_ID || "64bc4b23-6b09-469c-967c-8a87a619dacb";
const KEY_PATH = process.env.EXPO_ASC_API_KEY_PATH || process.env.ASC_KEY_PATH || `.secrets/AuthKey_${KEY_ID}.p8`;
const BUNDLE_ID = process.env.BUNDLE_IDENTIFIER || "app.livenew.mobile";
const APP_GROUP_IDENTIFIER = "group.app.livenew.mobile";
const APP_GROUP_NAME = "LiveNew Shared";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt() {
  if (!existsSync(KEY_PATH)) {
    throw new Error(`ASC private key not found at ${KEY_PATH}.`);
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

async function asc(method, pathAndQuery, body) {
  const url = `https://api.appstoreconnect.apple.com/v1${pathAndQuery}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, statusText: res.statusText, body: parsed, text };
}

async function findBundleId() {
  const r = await asc("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  if (!r.ok) throw new Error(`Looking up bundle ID failed: ${r.status} ${r.statusText}\n${r.text}`);
  const id = r.body?.data?.[0]?.id;
  if (!id) throw new Error(`No bundle ID record found for ${BUNDLE_ID}`);
  return id;
}

async function findAppGroup() {
  const r = await asc("GET", `/appGroups?filter[identifier]=${encodeURIComponent(APP_GROUP_IDENTIFIER)}&limit=1`);
  if (!r.ok) {
    // Some 401/403 responses come back here if scope is wrong — surface them.
    if (r.status === 403 || r.status === 401) {
      throw new Error(`ASC denied appGroups access (${r.status}). The API key may not have App Group scope.\n${r.text}`);
    }
    return null;
  }
  return r.body?.data?.[0]?.id || null;
}

async function enableCapability(bundleIdInternalId) {
  // Apple's capability enablement endpoint. Idempotent: if already enabled
  // returns CONFLICT 409 which we treat as success.
  const r = await asc("POST", `/bundleIdCapabilities`, {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "APP_GROUPS" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundleIdInternalId } },
      },
    },
  });
  if (r.ok) return { status: "created", id: r.body?.data?.id };
  if (r.status === 409 || (r.body?.errors || []).some((e) => /already|exist|duplicate/i.test(e?.detail || e?.title || ""))) {
    return { status: "already_enabled" };
  }
  throw new Error(`Enable APP_GROUPS failed: ${r.status} ${r.statusText}\n${r.text}`);
}

async function createAppGroup() {
  const existing = await findAppGroup();
  if (existing) return { status: "already_exists", id: existing };

  const r = await asc("POST", `/appGroups`, {
    data: {
      type: "appGroups",
      attributes: {
        identifier: APP_GROUP_IDENTIFIER,
        name: APP_GROUP_NAME,
      },
    },
  });
  if (!r.ok) throw new Error(`Create app group failed: ${r.status} ${r.statusText}\n${r.text}`);
  return { status: "created", id: r.body?.data?.id };
}

async function associateAppGroup(bundleIdInternalId, appGroupInternalId) {
  // POST adds without removing existing groups.
  const r = await asc("POST", `/bundleIds/${bundleIdInternalId}/relationships/appGroups`, {
    data: [{ type: "appGroups", id: appGroupInternalId }],
  });
  if (r.ok) return { status: "associated" };
  if (r.status === 409 || /already|exist/i.test(r.text || "")) {
    return { status: "already_associated" };
  }
  throw new Error(`Associate app group failed: ${r.status} ${r.statusText}\n${r.text}`);
}

(async () => {
  try {
    console.log(`Bundle: ${BUNDLE_ID}`);
    console.log(`App group: ${APP_GROUP_IDENTIFIER}`);
    console.log("");

    const bundleInternal = await findBundleId();
    console.log(`✓ Found bundle ID record (internal id ${bundleInternal})`);

    const cap = await enableCapability(bundleInternal);
    console.log(`✓ APP_GROUPS capability: ${cap.status}${cap.id ? ` (${cap.id})` : ""}`);

    const group = await createAppGroup();
    console.log(`✓ App group: ${group.status} (${group.id})`);

    const assoc = await associateAppGroup(bundleInternal, group.id);
    console.log(`✓ Association: ${assoc.status}`);

    console.log("\n🎉 App Group is enabled and associated. Next EAS build should sign cleanly.");
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  }
})();
