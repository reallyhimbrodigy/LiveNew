export function isCanaryEnabled(env = process.env) {
  const allowlist = (env.CANARY_ALLOWLIST || "").trim();
  return Boolean(allowlist);
}
