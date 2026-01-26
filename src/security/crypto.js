import crypto from "crypto";

const SECRET_KEY = process.env.SECRET_KEY || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const ALPHA_MODE = process.env.ALPHA_MODE === "true";
const REQUIRE_KEY = NODE_ENV === "production" || ALPHA_MODE;

let cachedKey = null;

function deriveKey() {
  if (cachedKey) return cachedKey;
  if (!SECRET_KEY) {
    if (REQUIRE_KEY) {
      throw new Error("SECRET_KEY is required for encryption in production/alpha");
    }
    return null;
  }
  cachedKey = crypto.createHash("sha256").update(SECRET_KEY).digest();
  return cachedKey;
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith("enc:");
}

export function hashString(value) {
  if (value == null) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function encryptString(value) {
  if (value == null) return value;
  if (isEncrypted(value)) return value;
  const key = deriveKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `enc:${payload}`;
}

export function decryptString(value) {
  if (value == null) return value;
  if (!isEncrypted(value)) return value;
  const key = deriveKey();
  if (!key) return value;
  const raw = Buffer.from(value.slice(4), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

