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

  const headers = { "Content-Type": "application/json" };
  if (res && res.livenewApiVersion) {
    headers["x-api-version"] = res.livenewApiVersion;
  }
  res.writeHead(httpCode, headers);
  res.errorCode = code;
  res.end(JSON.stringify(payload));
}
