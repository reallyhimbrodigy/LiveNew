const MODES = new Set(["dev", "internal", "alpha", "prod", "test"]);

export function getEnvMode() {
  const raw = String(process.env.ENV_MODE || "").trim().toLowerCase();
  if (!raw) return "internal";
  if (MODES.has(raw)) return raw;
  return "internal";
}

export function getEnvPolicy(overrideMode = null) {
  const envMode = overrideMode || getEnvMode();
  const isDevLike = envMode === "dev" || envMode === "internal" || envMode === "test";
  const isProdLike = envMode === "alpha" || envMode === "prod";
  return {
    envMode,
    allowDevRoutes: isDevLike,
    allowStageContentPreview: isDevLike,
    allowVerboseErrors: isDevLike,
    allowCookieAuth: !isProdLike,
    allowHardResetButton: isDevLike,
  };
}
