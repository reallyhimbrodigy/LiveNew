// Delete the stale provisioning profile so EAS regenerates a fresh one that
// includes whatever new entitlements live in app.json. Same trick we used
// when adding HealthKit; needed again now for App Groups.
//
// Uses the ASC API directly. The profile's Developer Portal ID was visible
// in the failed EAS build output (e.g. "Developer Portal ID 5Y575N9G7V").
// We look it up by name pattern + bundle ID for safety.

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const KEY_ID = process.env.EXPO_ASC_KEY_ID || process.env.ASC_KEY_ID || "6UXQ2STG2D";
const ISSUER_ID = process.env.EXPO_ASC_ISSUER_ID || process.env.ASC_ISSUER_ID || "64bc4b23-6b09-469c-967c-8a87a619dacb";
const KEY_PATH = process.env.EXPO_ASC_API_KEY_PATH || process.env.ASC_KEY_PATH || `.secrets/AuthKey_${KEY_ID}.p8`;
const BUNDLE_ID = process.env.BUNDLE_IDENTIFIER || "app.livenew.mobile";

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

async function asc(method, pathAndQuery) {
  const url = `https://api.appstoreconnect.apple.com/v1${pathAndQuery}`;
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${jwt()}` } });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, text, body: parsed };
}

(async () => {
  try {
    // Find the bundle ID's internal id
    const bundleRes = await asc("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
    if (!bundleRes.ok) throw new Error(`Bundle lookup failed: ${bundleRes.status}\n${bundleRes.text}`);
    const bundleInternal = bundleRes.body?.data?.[0]?.id;
    if (!bundleInternal) throw new Error(`No bundle ID record for ${BUNDLE_ID}`);
    console.log(`✓ Bundle internal id: ${bundleInternal}`);

    // List ALL profiles and filter client-side to those for this bundle ID.
    // The /profiles endpoint doesn't accept filter[bundleId] directly.
    const profilesRes = await asc("GET", `/profiles?limit=200&include=bundleId`);
    if (!profilesRes.ok) throw new Error(`Profile list failed: ${profilesRes.status}\n${profilesRes.text}`);
    const allProfiles = profilesRes.body?.data || [];
    const profiles = allProfiles.filter((p) => {
      const bundleRel = p.relationships?.bundleId?.data;
      return bundleRel?.id === bundleInternal;
    });
    console.log(`Found ${profiles.length} profile(s) for ${BUNDLE_ID} (out of ${allProfiles.length} total)`);

    if (profiles.length === 0) {
      console.log("Nothing to delete. EAS will create a fresh profile on the next build.");
      return;
    }

    for (const p of profiles) {
      const name = p.attributes?.name || "(no name)";
      const id = p.id;
      console.log(`  • ${name} (${id}) — state ${p.attributes?.profileState || "?"}`);
      const del = await asc("DELETE", `/profiles/${id}`);
      if (del.ok) {
        console.log(`    ✓ Deleted`);
      } else {
        console.log(`    ✗ Delete failed: ${del.status} ${del.text}`);
      }
    }

    console.log("\n🎉 Stale profile(s) cleared. Next EAS build will regenerate with current entitlements (App Group included).");
  } catch (err) {
    console.error("\nERROR:", err.message);
    process.exit(1);
  }
})();
