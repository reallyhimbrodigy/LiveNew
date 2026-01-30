import { getEnvPolicy } from "./envPolicy.js";

export class AppError extends Error {
  constructor(code, message, httpStatus = 500, field = null, details = null) {
    super(message || code || "error");
    this.name = "AppError";
    this.code = code || "error";
    this.httpStatus = httpStatus || 500;
    this.field = field || null;
    this.details = details || null;
  }
}

export function badRequest(code, message, field, details) {
  return new AppError(code || "bad_request", message || "Bad request", 400, field, details);
}

export function forbidden(code, message, field, details) {
  return new AppError(code || "forbidden", message || "Forbidden", 403, field, details);
}

export function notFound(code, message, field, details) {
  return new AppError(code || "not_found", message || "Not found", 404, field, details);
}

export function conflict(code, message, field, details) {
  return new AppError(code || "conflict", message || "Conflict", 409, field, details);
}

export function internal(code, message, field, details) {
  return new AppError(code || "internal", message || "Something went wrong", 500, field, details);
}

function allowVerboseErrors() {
  return getEnvPolicy().allowVerboseErrors;
}

function normalizeError(errOrStatus, code, message, field) {
  if (errOrStatus instanceof AppError) return errOrStatus;
  if (typeof errOrStatus === "number") {
    return new AppError(code || "error", message || "Error", errOrStatus, field || null);
  }
  if (errOrStatus instanceof Error) {
    if (errOrStatus.code || errOrStatus.httpStatus) {
      return new AppError(
        errOrStatus.code || code || "error",
        errOrStatus.message || message || "Error",
        errOrStatus.httpStatus || 500,
        errOrStatus.field || field || null,
        errOrStatus.details || null
      );
    }
    return internal("internal", "Something went wrong", null, { message: errOrStatus.message });
  }
  return internal("internal", "Something went wrong");
}

export function sendError(res, errOrStatus, code, message, field, requestId) {
  const err = normalizeError(errOrStatus, code, message, field);
  const resolvedRequestId = requestId || res?.livenewRequestId || undefined;
  const payload = {
    ok: false,
    error: {
      code: err.code || "error",
      message: err.message || "Error",
      field: err.field || undefined,
      requestId: resolvedRequestId,
    },
  };
  payload.errorCode = err.code || "error";

  if (res?.livenewUserId) payload.userId = res.livenewUserId;
  if (err.code === "consent_required" && err.details?.required) {
    payload.error.required = err.details.required;
  }
  if (err.code === "consent_required_version" && err.details?.requiredVersion != null) {
    payload.error.requiredVersion = err.details.requiredVersion;
    if (err.details.userVersion != null) payload.error.userVersion = err.details.userVersion;
  }
  const exposeDetails =
    err.details?.expose === true || err.code === "consent_required" || err.code === "consent_required_version";
  if (allowVerboseErrors() || exposeDetails) {
    const details = err.details || undefined;
    if (details) {
      if (details.expose) {
        const { expose, ...rest } = details;
        payload.details = rest;
      } else {
        payload.details = details;
      }
    }
  }

  const headers = { "Content-Type": "application/json", ...(res?.livenewExtraHeaders || {}) };
  if (res?.livenewApiVersion) headers["x-api-version"] = res.livenewApiVersion;
  res.writeHead(err.httpStatus || 500, headers);
  res.errorCode = err.code;
  res.end(JSON.stringify(payload));
}
