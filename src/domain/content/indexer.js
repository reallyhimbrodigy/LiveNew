let cachedIndex = null;

export function buildLibraryIndex(library) {
  const index = {
    byKind: {
      workout: Array.isArray(library.workouts) ? library.workouts : [],
      nutrition: Array.isArray(library.nutrition) ? library.nutrition : [],
      reset: Array.isArray(library.resets) ? library.resets : [],
    },
    byTag: {
      workout: new Map(),
      nutrition: new Map(),
      reset: new Map(),
    },
    byNoveltyGroup: {
      workout: new Map(),
      nutrition: new Map(),
      reset: new Map(),
    },
  };

  const addItem = (kind, item) => {
    (item.tags || []).forEach((tag) => {
      const map = index.byTag[kind];
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(item);
    });
    const group = item.noveltyGroup;
    if (group) {
      const map = index.byNoveltyGroup[kind];
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(item);
    }
  };

  index.byKind.workout.forEach((item) => addItem("workout", item));
  index.byKind.nutrition.forEach((item) => addItem("nutrition", item));
  index.byKind.reset.forEach((item) => addItem("reset", item));

  return index;
}

export function setLibraryIndex(library) {
  cachedIndex = buildLibraryIndex(library);
  return cachedIndex;
}

export function getLibraryIndex(library) {
  if (library) {
    // Per-request library overrides should not mutate the shared cache.
    return buildLibraryIndex(library);
  }
  if (!cachedIndex) {
    cachedIndex = buildLibraryIndex({ workouts: [], nutrition: [], resets: [] });
  }
  return cachedIndex;
}

export function getCandidates(index, kind, tag) {
  if (!index) return [];
  if (!tag) return index.byKind[kind] || [];
  const map = index.byTag[kind];
  const list = map?.get(tag);
  return list && list.length ? list : index.byKind[kind] || [];
}
