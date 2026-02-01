import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const res = spawnSync(process.execPath, ["scripts/run-stability-window.js", "--daily"], {
  cwd: process.cwd(),
  env: { ...process.env },
  encoding: "utf8",
});

assert(res.status === 2, "run-stability-window should require STABILITY_WINDOW=true");
console.log(JSON.stringify({ ok: true }));
