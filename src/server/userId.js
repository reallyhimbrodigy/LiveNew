export function sanitizeUserId(raw) {
  if (!raw) return "default";
  const value = String(raw).trim();
  if (!value) return "default";
  if (value.length > 64) return "default";
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return "default";
  return value;
}

export function getUserId(req) {
  const header = req?.headers?.["x-livenew-user"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue) return sanitizeUserId(headerValue);

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryValue = url.searchParams.get("userId");
    return sanitizeUserId(queryValue);
  } catch {
    return "default";
  }
}
