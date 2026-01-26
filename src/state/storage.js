import fs from "fs/promises";
import path from "path";
import { normalizeState } from "../domain/schema.js";

const queues = new Map();

function getQueue(userId) {
  if (!queues.has(userId)) {
    queues.set(userId, { pending: null, timer: null, writing: false, dirty: false });
  }
  return queues.get(userId);
}

export function getStatePath(userId = "default") {
  const safeId = userId || "default";
  return path.join("data", `state.${safeId}.json`);
}

async function ensureDirFor(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function loadState(userId = "default") {
  const filePath = getStatePath(userId);
  await ensureDirFor(filePath);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return normalizeState({});
    }
    if (err instanceof SyntaxError) {
      const stamp = Date.now();
      const dir = path.dirname(filePath);
      try {
        await fs.mkdir(dir, { recursive: true });
        const corruptPath = path.join(dir, `state.${userId}.corrupt.${stamp}.json`);
        await fs.rename(filePath, corruptPath);
      } catch (renameErr) {
        console.warn("Failed to rename corrupt state", renameErr);
      }
      return normalizeState({});
    }
    console.warn("Failed to load state", err);
    return normalizeState({});
  }
}

function scheduleFlush(userId) {
  const queue = getQueue(userId);
  if (queue.timer) return;
  queue.timer = setTimeout(() => {
    queue.timer = null;
    flushSave(userId);
  }, 250);
}

export async function enqueueSave(userId, state) {
  const queue = getQueue(userId);
  queue.pending = normalizeState(state);
  queue.dirty = true;
  scheduleFlush(userId);
}

async function flushSave(userId) {
  const queue = getQueue(userId);
  if (!queue.pending) return;
  if (queue.writing) {
    queue.dirty = true;
    return;
  }

  queue.writing = true;
  const snapshot = queue.pending;
  queue.dirty = false;

  try {
    const filePath = getStatePath(userId);
    await ensureDirFor(filePath);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2));
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    console.warn("Failed to persist state", err);
    queue.dirty = true;
  }

  queue.writing = false;
  if (queue.dirty) scheduleFlush(userId);
}

async function waitForQueue(userId) {
  const queue = getQueue(userId);
  if (!queue.writing && !queue.dirty) return;
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (queue.writing) return waitForQueue(userId);
  if (queue.dirty) {
    await flushSave(userId);
    return waitForQueue(userId);
  }
}

export async function flushAll() {
  const userIds = Array.from(queues.keys());
  for (const userId of userIds) {
    const queue = getQueue(userId);
    if (queue.timer) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    await flushSave(userId);
    await waitForQueue(userId);
  }
}
