const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = ["email", "token", "refresh", "authorization", "notes"];

function shouldRedactKey(key) {
  const lower = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive));
}

function sanitizeValue(value, depth = 0) {
  if (depth > 6) return value;
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (value instanceof Error) {
    return sanitizeValue({ message: value.message, stack: value.stack }, depth + 1);
  }
  if (typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, entry]) => {
      next[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(entry, depth + 1);
    });
    return next;
  }
  return value;
}

function formatEntry(entry) {
  if (typeof entry === "string") return entry;
  return sanitizeValue(entry);
}

export function logInfo(entry) {
  const formatted = formatEntry(entry);
  if (typeof formatted === "string") {
    console.log(formatted);
  } else {
    console.log(JSON.stringify(formatted));
  }
}

export function logWarn(entry) {
  const formatted = formatEntry(entry);
  if (typeof formatted === "string") {
    console.warn(formatted);
  } else {
    console.warn(JSON.stringify(formatted));
  }
}

export function logError(entry) {
  const formatted = formatEntry(entry);
  if (typeof formatted === "string") {
    console.error(formatted);
  } else {
    console.error(JSON.stringify(formatted));
  }
}
