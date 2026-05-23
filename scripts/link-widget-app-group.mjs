// Link the existing `group.app.livenew.mobile` App Group to the widget
// bundle ID (app.livenew.mobile.widget). The main bundle ID is already
// associated with it; we just need to add the widget bundle to the same
// group so its provisioning profile gets the correct entitlement.

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const KEY_ID = process.env.ASC_KEY_ID || "6UXQ2STG2D";
const ISSUER_ID = process.env.ASC_ISSUER_ID || "64bc4b23-6b09-469c-967c-8a87a619dacb";
const KEY_PATH = process.env.ASC_KEY_PATH || `.secrets/AuthKey_${KEY_ID}.p8`;
const MAIN_BUNDLE_ID = "app.livenew.mobile";
const WIDGET_BUNDLE_ID = "app.livenew.mobile.widget";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwt() {
  if (!existsSync(KEY_PATH)) throw new Error(`No key at ${KEY_PATH}`);
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

async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: parsed, text };
}

(async () => {
  try {
    // 1. Find both bundle records
    const mainQ = await asc("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(MAIN_BUNDLE_ID)}&limit=1`);
    const widgetQ = await asc("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(WIDGET_BUNDLE_ID)}&limit=1`);
    const mainId = mainQ.body?.data?.[0]?.id;
    const widgetId = widgetQ.body?.data?.[0]?.id;
    if (!mainId) throw new Error(`Main bundle ${MAIN_BUNDLE_ID} not found`);
    if (!widgetId) throw new Error(`Widget bundle ${WIDGET_BUNDLE_ID} not found`);
    console.log(`Main bundle: ${mainId}`);
    console.log(`Widget bundle: ${widgetId}`);

    // 2. Get the main bundle's associated app groups — that's our source of truth
    //    for the group's internal Apple ID. The standalone /appGroups endpoint
    //    isn't reliably available via API key, but the relationship one is.
    const groupsQ = await asc("GET", `/bundleIds/${mainId}/appGroups?limit=50`);
    if (!groupsQ.ok) throw new Error(`Failed to list main bundle's app groups: ${groupsQ.status}\n${groupsQ.text}`);
    const groups = groupsQ.body?.data || [];
    console.log(`Main bundle has ${groups.length} app group(s):`);
    for (const g of groups) {
      console.log(`  - ${g.attributes?.identifier} (${g.id})`);
    }
    const target = groups.find((g) => g.attributes?.identifier === "group.app.livenew.mobile");
    if (!target) {
      throw new Error("group.app.livenew.mobile not associated with main bundle — set it up first.");
    }
    const groupInternalId = target.id;

    // 3. Associate that app group with the widget bundle
    const assoc = await asc("POST", `/bundleIds/${widgetId}/relationships/appGroups`, {
      data: [{ type: "appGroups", id: groupInternalId }],
    });
    if (assoc.ok) {
      console.log(`\n✓ Linked group.app.livenew.mobile to ${WIDGET_BUNDLE_ID}`);
    } else if (assoc.status === 409 || /already|exist/i.test(assoc.text || "")) {
      console.log(`\n✓ Already linked (${assoc.status})`);
    } else {
      throw new Error(`Associate failed: ${assoc.status}\n${assoc.text}`);
    }

    console.log("\nNext: re-run `eas credentials -p ios` and regenerate the widget profile so it picks up the App Group entitlement, then rebuild.");
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  }
})();
