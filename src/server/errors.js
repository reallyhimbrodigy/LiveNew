export function sendError(res, httpCode, code, message, field) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      field: field || undefined,
    },
  };

  if (res && res.livenewUserId) {
    payload.userId = res.livenewUserId;
  }

  res.writeHead(httpCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
