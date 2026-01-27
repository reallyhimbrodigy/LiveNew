import crypto from "crypto";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    const out = {};
    keys.forEach((key) => {
      out[key] = canonicalize(value[key]);
    });
    return out;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashJSON(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function sanitizeContentItem(item) {
  if (!item || typeof item !== "object") return item;
  const clone = { ...item };
  delete clone.status;
  delete clone.updatedByAdmin;
  delete clone.updated_at;
  delete clone.updatedAt;
  delete clone.updated_by_admin;
  return clone;
}

export function sanitizePack(pack) {
  if (!pack || typeof pack !== "object") return pack;
  const clone = { ...pack };
  delete clone.updated_at;
  delete clone.updatedAt;
  return clone;
}
