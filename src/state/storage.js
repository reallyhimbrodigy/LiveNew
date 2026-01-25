import fs from "fs/promises";
import { dirname } from "path";
import { normalizeState } from "../domain/schema.js";

export const STATE_PATH = process.env.STATE_PATH || "data/state.json";

let pending = null;
let timer = null;
let writing = false;
let dirty = false;

async function ensureDir() {
  await fs.mkdir(dirname(STATE_PATH), { recursive: true });
}

export async function loadState() {
  await ensureDir();
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return normalizeState({});
    }
    if (err instanceof SyntaxError) {
      const stamp = Date.now();
      try {
        await fs.mkdir("data", { recursive: true });
        await fs.rename(STATE_PATH, `data/state.corrupt.${stamp}.json`);
      } catch (renameErr) {
        console.warn("Failed to rename corrupt state", renameErr);
      }
      return normalizeState({});
    }
    console.warn("Failed to load state", err);
    return normalizeState({});
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushSave();
  }, 250);
}

export async function enqueueSave(state) {
  pending = normalizeState(state);
  dirty = true;
  scheduleFlush();
}

async function flushSave() {
  if (!pending) return;
  if (writing) {
    dirty = true;
    return;
  }

  writing = true;
  const snapshot = pending;
  dirty = false;

  try {
    await ensureDir();
    const tmpPath = `${STATE_PATH}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2));
    await fs.rename(tmpPath, STATE_PATH);
  } catch (err) {
    console.warn("Failed to persist state", err);
    dirty = true;
  }

  writing = false;
  if (dirty) scheduleFlush();
}
