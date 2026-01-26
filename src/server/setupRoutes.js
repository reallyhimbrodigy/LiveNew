import fs from "fs/promises";
import path from "path";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAdminEmail(dataDir, email) {
  const filePath = path.join(dataDir, "admin_emails.json");
  let existing = [];
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    // ignore
  }
  const next = Array.from(new Set([...existing, email]));
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2));
}

export async function handleSetupRoutes(req, res, config, deps) {
  const { url, sendJson, sendError, computeSummary, isAdminConfigured, addAdminEmail, seedInitialProfile } = deps;
  const pathname = url.pathname;

  if (pathname === "/setup/status" && req.method === "GET") {
    const summary = await computeSummary();
    const missing = {
      secretKey: !summary.secretKey.present || (config.secretKeyPolicy.requireReal && summary.secretKey.ephemeral),
      adminEmails: !isAdminConfigured(),
      db: !summary.storage.ok,
      dataDirWritable: !summary.dataDir.writable,
      csrfEnabled: (config.isAlphaLike || config.isProdLike) && !summary.csrf.enabled,
      devRoutesEnabled: config.isDevLike && !summary.devRoutes.enabled,
    };
    const notes = [];
    if (missing.secretKey) notes.push("SECRET_KEY missing or invalid for current mode.");
    if (missing.adminEmails) notes.push("No ADMIN_EMAILS configured.");
    if (missing.db) notes.push("Database unavailable.");
    if (missing.dataDirWritable) notes.push("Data directory not writable.");
    if (missing.csrfEnabled) notes.push("CSRF protection disabled.");
    if (missing.devRoutesEnabled) notes.push("Dev routes disabled.");
    sendJson(res, 200, { ok: true, envMode: config.envMode, missing, notes });
    return true;
  }

  if (pathname === "/setup/complete" && req.method === "POST") {
    if (config.envMode !== "dogfood") {
      sendError(res, 403, "setup_not_allowed", "Setup completion is only allowed in dogfood mode.");
      return true;
    }
    const body = await readBody(req);
    const adminEmail = String(body?.adminEmail || "").trim().toLowerCase();
    if (!adminEmail) {
      sendError(res, 400, "admin_email_required", "adminEmail is required", "adminEmail");
      return true;
    }
    await writeAdminEmail(config.dataDir, adminEmail);
    addAdminEmail(adminEmail);
    if (body?.initialProfile && typeof seedInitialProfile === "function") {
      await seedInitialProfile(adminEmail, body.initialProfile);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
