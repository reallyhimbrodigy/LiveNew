export function buildReleaseChecklist(checkMap = {}) {
  const checks = Object.entries(checkMap).map(([key, entry]) => ({
    key,
    pass: Boolean(entry?.pass),
    details: entry?.details || {},
  }));
  const pass = checks.every((check) => check.pass);
  return { pass, checks };
}
