import { spawnSync } from "child_process";

export function parseJsonLine(output) {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  return null;
}

export function runNode(scriptPath, { env = {}, args = [] } = {}) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const out = (res.stdout || "").trim();
  const err = (res.stderr || "").trim();
  return {
    ok: res.status === 0,
    code: res.status ?? 1,
    stdout: out,
    stderr: err,
    parsed: parseJsonLine(out) || parseJsonLine(err),
  };
}
