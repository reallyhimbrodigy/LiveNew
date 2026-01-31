import fs from "fs";
import path from "path";

export function artifactsBaseDir() {
  return process.env.ARTIFACTS_DIR || path.join(process.cwd(), "artifacts");
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeArtifact(subdir, prefix, payload) {
  const base = artifactsBaseDir();
  const dir = path.join(base, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, `${timestamp()}-${prefix}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export function writeLog(subdir, prefix, content, ext = "log") {
  const base = artifactsBaseDir();
  const dir = path.join(base, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, `${timestamp()}-${prefix}.${ext}`);
  fs.writeFileSync(filePath, content || "");
  return filePath;
}
