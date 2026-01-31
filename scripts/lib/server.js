import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { setTimeout as delay } from "timers/promises";

const ROOT = process.cwd();

async function fetchJson(baseUrl, pathname) {
  const res = await fetch(`${baseUrl}${pathname}`);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { res, payload };
}

async function waitForReady(baseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const { res, payload } = await fetchJson(baseUrl, "/readyz");
      if (res.ok && payload?.ok) return;
    } catch {
      // ignore
    }
    await delay(200);
  }
  throw new Error("Server not ready");
}

export async function withServer(envOverrides, fn) {
  const PORT = String(4200 + Math.floor(Math.random() * 500));
  const DATA_DIR = path.join(ROOT, "data", `test-static-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const env = {
    ...process.env,
    ENV_MODE: "dev",
    TEST_MODE: "true",
    AUTH_REQUIRED: "false",
    PORT,
    DATA_DIR,
    DB_PATH: path.join(DATA_DIR, "livenew.sqlite"),
    ...envOverrides,
  };
  const server = spawn("node", ["src/server/index.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const baseUrl = `http://127.0.0.1:${PORT}`;
  try {
    await waitForReady(baseUrl);
    return await fn(baseUrl);
  } finally {
    server.kill("SIGTERM");
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  }
}

export async function withOptionalServer(fn, envOverrides = {}) {
  const baseUrl = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
  if (baseUrl) {
    return await fn(baseUrl);
  }
  return await withServer(envOverrides, fn);
}
