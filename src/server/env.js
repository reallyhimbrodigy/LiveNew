import crypto from "crypto";

let generatedSecret = false;

export function isAlphaMode() {
  return process.env.ALPHA_MODE === "true";
}

export function isProd() {
  return process.env.NODE_ENV === "production";
}

export function requireSecretKeyOrFallback() {
  const secret = process.env.SECRET_KEY;
  if (isAlphaMode()) {
    if (!secret || secret.length < 32) {
      throw new Error("LiveNew SECRET_KEY is required in production/alpha.");
    }
    return secret;
  }
  if (!secret) {
    const k = crypto.randomBytes(32).toString("hex");
    process.env.SECRET_KEY = k;
    generatedSecret = true;
    console.warn(
      "LiveNew: SECRET_KEY missing; generated ephemeral dev key. Sessions/data will not survive restarts."
    );
    return k;
  }
  if (secret.length < 32) {
    console.warn("LiveNew: SECRET_KEY is shorter than 32 chars; using as-is for non-alpha.");
  }
  return secret;
}

export function isEphemeralSecretKey() {
  return generatedSecret;
}
