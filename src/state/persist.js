import AsyncStorage from "@react-native-async-storage/async-storage";

let pending = null;
let timer = null;
let writing = false;
let dirty = false;

export function clearPersistQueue() {
  pending = null;
  dirty = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushPersistNow();
  }, 250);
}

export function enqueuePersist(key, payload) {
  pending = { key, payload };
  dirty = true;
  scheduleFlush();
}

export async function flushPersistNow() {
  if (!pending) return;
  if (writing) {
    dirty = true;
    return;
  }
  writing = true;
  const { key, payload } = pending;
  dirty = false;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn("Persist failed", err);
    dirty = true;
  }
  writing = false;
  if (dirty) scheduleFlush();
}

export async function loadJSON(key) {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function removeJSON(key) {
  await AsyncStorage.removeItem(key);
}
