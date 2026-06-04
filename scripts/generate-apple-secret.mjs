// Generates the Apple Sign In client secret JWT that Supabase requires in
// the Apple provider's "Secret Key (for OAuth)" field.
//
// Apple won't accept the raw .p8 — it's a private signing key, not a JWT.
// You use the .p8 to SIGN a short-lived JWT that authenticates Supabase
// to Apple's OAuth servers. Max lifetime: 6 months.
//
// Usage:
//   node scripts/generate-apple-secret.mjs path/to/AuthKey_ZQ932D4S7V.p8
//
// Then copy the printed JWT and paste into:
//   Supabase Dashboard → Authentication → Providers → Apple
//   → "Secret Key (for OAuth)" field → Save
//
// Re-run this every ~5 months before the JWT expires.

import { readFileSync } from "node:fs";
import { createSign, createPrivateKey } from "node:crypto";

// ── Edit these once if you ever change them. ────────────────────────────
const TEAM_ID    = "8KT9332327";        // Apple Developer → top right
const KEY_ID     = "ZQ932D4S7V";        // From the .p8 filename: AuthKey_<KEY_ID>.p8
const SERVICES_ID = "app.livenew.signin"; // The Services ID identifier you created
const EXPIRES_IN_DAYS = 180;             // Apple max is 180 days (~6 months)
// ────────────────────────────────────────────────────────────────────────

const p8Path = process.argv[2];
if (!p8Path) {
  console.error("Usage: node scripts/generate-apple-secret.mjs path/to/AuthKey.p8");
  process.exit(1);
}

const p8 = readFileSync(p8Path, "utf8");

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
const payload = base64url(JSON.stringify({
  iss: TEAM_ID,
  iat: now,
  exp: now + EXPIRES_IN_DAYS * 24 * 60 * 60,
  aud: "https://appleid.apple.com",
  sub: SERVICES_ID,
}));

const signingInput = `${header}.${payload}`;
const privateKey = createPrivateKey(p8);
const signature = createSign("SHA256")
  .update(signingInput)
  // ES256 JWTs require IEEE P-1363 encoding (r||s concatenated), NOT the
  // DER format Node defaults to. Apple rejects DER signatures silently.
  .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });

const jwt = `${signingInput}.${base64url(signature)}`;

console.log("\n── Apple Sign In client secret JWT ─────────────────────────────");
console.log(jwt);
console.log("────────────────────────────────────────────────────────────────");
console.log(`Expires: ${new Date((now + EXPIRES_IN_DAYS * 86400) * 1000).toISOString()}`);
console.log("Re-run this script before that date and update Supabase.\n");

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
