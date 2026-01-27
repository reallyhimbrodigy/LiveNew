import { canonicalize } from "../domain/content/snapshotHash.js";

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function buildMap(entries, keyFn, valueFn) {
  const map = new Map();
  (entries || []).forEach((entry) => {
    const key = keyFn(entry);
    if (!key) return;
    map.set(key, valueFn(entry));
  });
  return map;
}

export function diffSnapshots({ itemsA = [], itemsB = [], packsA = [], packsB = [], paramsA = [], paramsB = [] }) {
  const itemKey = (entry) => `${entry.kind}:${entry.itemId}`;
  const itemMapA = buildMap(itemsA, itemKey, (entry) => ({ ...entry, json: stableJson(entry.item) }));
  const itemMapB = buildMap(itemsB, itemKey, (entry) => ({ ...entry, json: stableJson(entry.item) }));

  const addedItems = [];
  const removedItems = [];
  const changedItems = [];

  for (const [key, entryB] of itemMapB.entries()) {
    const entryA = itemMapA.get(key);
    if (!entryA) {
      addedItems.push({ kind: entryB.kind, itemId: entryB.itemId });
      continue;
    }
    if (entryA.json !== entryB.json) {
      changedItems.push({ kind: entryB.kind, itemId: entryB.itemId });
    }
  }
  for (const [key, entryA] of itemMapA.entries()) {
    if (!itemMapB.has(key)) {
      removedItems.push({ kind: entryA.kind, itemId: entryA.itemId });
    }
  }

  const packMapA = buildMap(packsA, (entry) => entry.packId, (entry) => stableJson(entry.pack));
  const packMapB = buildMap(packsB, (entry) => entry.packId, (entry) => stableJson(entry.pack));
  const changedPacks = [];
  const addedPacks = [];
  const removedPacks = [];

  for (const [packId, jsonB] of packMapB.entries()) {
    const jsonA = packMapA.get(packId);
    if (!jsonA) {
      addedPacks.push(packId);
    } else if (jsonA !== jsonB) {
      changedPacks.push(packId);
    }
  }
  for (const packId of packMapA.keys()) {
    if (!packMapB.has(packId)) removedPacks.push(packId);
  }

  const paramMapA = buildMap(paramsA, (entry) => entry.key, (entry) => ({ value: stableJson(entry.value), version: entry.version }));
  const paramMapB = buildMap(paramsB, (entry) => entry.key, (entry) => ({ value: stableJson(entry.value), version: entry.version }));
  const changedParams = [];
  const addedParams = [];
  const removedParams = [];

  for (const [key, entryB] of paramMapB.entries()) {
    const entryA = paramMapA.get(key);
    if (!entryA) {
      addedParams.push(key);
      continue;
    }
    if (entryA.value !== entryB.value || entryA.version !== entryB.version) {
      changedParams.push(key);
    }
  }
  for (const key of paramMapA.keys()) {
    if (!paramMapB.has(key)) removedParams.push(key);
  }

  return {
    items: { added: addedItems, removed: removedItems, changed: changedItems },
    packs: { added: addedPacks, removed: removedPacks, changed: changedPacks },
    params: { added: addedParams, removed: removedParams, changed: changedParams },
  };
}
