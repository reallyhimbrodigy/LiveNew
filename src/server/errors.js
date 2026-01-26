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
  if (res && res.livenewRequestId) {
    payload.requestId = res.livenewRequestId;
  }

  res.writeHead(httpCode, { "Content-Type": "application/json" });
  res.errorCode = code;
  res.end(JSON.stringify(payload));
}
