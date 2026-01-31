import fs from "fs";

function listOverrideEnvs(env) {
  return Object.keys(env)
    .filter((key) => key.startsWith("OVERRIDE_") && String(env[key] || "").trim())
    .sort();
}

export function evaluateEvidence({ env = process.env } = {}) {
  const launchWindow = env.LAUNCH_WINDOW === "true";
  if (!launchWindow) {
    return { ok: true, launchWindow: false, override: false };
  }

  const overrideEnvKeys = listOverrideEnvs(env);
  const overrideRequested =
    overrideEnvKeys.length > 0 ||
    env.ALLOW_OVERRIDE_WITH_EVIDENCE === "true" ||
    env.OVERRIDE === "true" ||
    Boolean(String(env.OVERRIDE_REASON || "").trim()) ||
    Boolean(String(env.EVIDENCE_FILE || "").trim());

  const evidenceBundleTemplate = {
    requiredEvidenceId: (env.REQUIRED_EVIDENCE_ID || "").trim() || null,
    requestId: (env.REQUEST_ID || "").trim(),
    scenarioPack: (env.SCENARIO_PACK || "").trim(),
  };

  if (!overrideRequested) {
    return { ok: true, launchWindow: true, override: false, evidenceBundle: evidenceBundleTemplate };
  }

  const evidenceId = (env.REQUIRED_EVIDENCE_ID || "").trim();
  if (!evidenceId) {
    return { ok: false, error: "missing_required_evidence_id", evidenceBundle: evidenceBundleTemplate };
  }

  const overrideReason = (env.OVERRIDE_REASON || "").trim();
  const evidenceFile = (env.EVIDENCE_FILE || "").trim();
  if (!overrideReason && !evidenceFile) {
    return {
      ok: false,
      error: "missing_override_reason",
      required: "OVERRIDE_REASON or EVIDENCE_FILE",
      evidenceBundle: evidenceBundleTemplate,
    };
  }

  if (evidenceFile && !fs.existsSync(evidenceFile)) {
    return { ok: false, error: "evidence_file_missing", evidenceFile, evidenceBundle: evidenceBundleTemplate };
  }

  return {
    ok: true,
    launchWindow: true,
    override: true,
    overrideEnvKeys,
    evidenceId,
    overrideReason: overrideReason || null,
    evidenceFile: evidenceFile || null,
    evidenceBundle: evidenceBundleTemplate,
  };
}
