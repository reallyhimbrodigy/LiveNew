const MODES = new Set(["dev", "dogfood", "alpha", "prod", "test"]);

export function getEnvMode() {
  const raw = String(process.env.ENV_MODE || "").trim().toLowerCase();
  if (!raw) return "dogfood";
  if (MODES.has(raw)) return raw;
  return "dogfood";
}

export function getEnvPolicy(overrideMode = null) {
  const envMode = overrideMode || getEnvMode();
  const isDevLike = envMode === "dev" || envMode === "dogfood" || envMode === "test";
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
