function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function diffValues(a, b, path = "") {
  const changes = [];
  if (Array.isArray(a) || Array.isArray(b)) {
    const aStr = JSON.stringify(a || []);
    const bStr = JSON.stringify(b || []);
    if (aStr !== bStr) {
      changes.push({ path, from: a || null, to: b || null });
    }
    return changes;
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach((key) => {
      changes.push(...diffValues(a[key], b[key], path ? `${path}.${key}` : key));
    });
    return changes;
  }
  if (a !== b) {
    changes.push({ path, from: a ?? null, to: b ?? null });
  }
  return changes;
}

export function diffDayContracts(fromDay, toDay) {
  const changes = diffValues(fromDay, toDay, "");
  const sections = {
    what: changes.filter((c) => c.path.startsWith("what")),
    why: changes.filter((c) => c.path.startsWith("why")),
    howLong: changes.filter((c) => c.path.startsWith("howLong")),
    details: changes.filter((c) => c.path.startsWith("details")),
  };
  return {
    summary: changes.map((c) => c.path),
    changes,
    sections,
  };
}
