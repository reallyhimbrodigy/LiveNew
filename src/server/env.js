import crypto from "crypto";

let warned = false;
let lastStatus = { secretKeyPresent: false, secretKeyEphemeral: false };

export function ensureSecretKey(config) {
  const secret = process.env.SECRET_KEY;
  const hasSecret = Boolean(secret);
  const ephemeralFlag = process.env.SECRET_KEY_EPHEMERAL === "true";

  if (config.secretKeyPolicy?.requireReal) {
    if (!hasSecret || secret.length < 32 || ephemeralFlag) {
      throw new Error("LiveNew SECRET_KEY is required in production/alpha.");
    }
    lastStatus = { secretKeyPresent: true, secretKeyEphemeral: false };
    return lastStatus;
  }

  if (!hasSecret) {
    const k = crypto.randomBytes(32).toString("hex");
    process.env.SECRET_KEY = k;
    process.env.SECRET_KEY_EPHEMERAL = "true";
    lastStatus = { secretKeyPresent: true, secretKeyEphemeral: true };
    if (!warned) {
      console.warn(
        "LiveNew: SECRET_KEY missing; generated ephemeral dev key. Sessions/data will not survive restarts."
      );
      warned = true;
    }
    return lastStatus;
  }

  if (secret.length < 32 && !warned) {
    console.warn("LiveNew: SECRET_KEY is shorter than 32 chars; using as-is for non-alpha.");
    warned = true;
  }

  lastStatus = { secretKeyPresent: true, secretKeyEphemeral: ephemeralFlag };
  return lastStatus;
}

export function getSecretKeyStatus() {
  return lastStatus;
}
