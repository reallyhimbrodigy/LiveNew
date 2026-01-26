import crypto from "crypto";
import { ensureSecretKey } from "../server/env.js";
import { getConfig } from "../server/config.js";
import {
  createRefreshTokenRow,
  getRefreshTokenByHash,
  revokeRefreshTokenById,
  replaceRefreshToken,
} from "../state/db.js";

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
}

function hmac(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signAccessToken({ userId, scope = "user", ttlSec = 15 * 60, sessionId = null }) {
  ensureSecretKey(getConfig());
  const secret = process.env.SECRET_KEY || "";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    scope,
    iat: now,
    exp: now + ttlSec,
    jti: crypto.randomUUID(),
    sid: sessionId || undefined,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAccessToken(token) {
  ensureSecretKey(getConfig());
  const secret = process.env.SECRET_KEY || "";
  if (!token || typeof token !== "string") {
    const err = new Error("Access token missing");
    err.code = "token_missing";
    throw err;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    const err = new Error("Access token invalid");
    err.code = "token_invalid";
    throw err;
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  if (signature.length !== expected.length) {
    const err = new Error("Access token invalid");
    err.code = "token_invalid";
    throw err;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    const err = new Error("Access token invalid");
    err.code = "token_invalid";
    throw err;
  }
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    const err = new Error("Access token invalid");
    err.code = "token_invalid";
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    const err = new Error("Access token expired");
    err.code = "token_expired";
    throw err;
  }
  if (!payload.sub) {
    const err = new Error("Access token invalid");
    err.code = "token_invalid";
    throw err;
  }
  return {
    ok: true,
    userId: payload.sub,
    scope: payload.scope || "user",
    exp: payload.exp,
    iat: payload.iat,
    jti: payload.jti,
    sessionId: payload.sid || null,
  };
}

export async function issueRefreshToken({ userId, deviceName }) {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const id = crypto.randomUUID();
  const now = new Date();
  const ttlMs = process.env.SECRET_KEY_EPHEMERAL === "true" ? 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  await createRefreshTokenRow({
    id,
    userId,
    tokenHash,
    createdAt: now.toISOString(),
    expiresAt,
    deviceName,
  });
  return { refreshToken: raw, refreshTokenId: id, expiresAt };
}

export async function verifyRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    const err = new Error("Refresh token missing");
    err.code = "refresh_missing";
    throw err;
  }
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const row = await getRefreshTokenByHash(tokenHash);
  if (!row) {
    const err = new Error("Refresh token invalid");
    err.code = "refresh_invalid";
    throw err;
  }
  if (row.revoked_at) {
    const err = new Error("Refresh token revoked");
    err.code = "refresh_revoked";
    throw err;
  }
  if (row.expires_at < new Date().toISOString()) {
    const err = new Error("Refresh token expired");
    err.code = "refresh_expired";
    throw err;
  }
  return { ok: true, userId: row.user_id, refreshTokenId: row.id, deviceName: row.device_name || null };
}

export async function rotateRefreshToken(oldRefreshToken, deviceName) {
  const verified = await verifyRefreshToken(oldRefreshToken);
  const next = await issueRefreshToken({ userId: verified.userId, deviceName: deviceName || verified.deviceName });
  await replaceRefreshToken(verified.refreshTokenId, next.refreshTokenId);
  return { ...next, userId: verified.userId };
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") return false;
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const row = await getRefreshTokenByHash(tokenHash);
  if (!row) return false;
  await revokeRefreshTokenById(row.id);
  return true;
}
