export function buildModelStamp({
  snapshotId,
  libraryHash,
  packsHash,
  paramsVersions,
  packId,
  cohortId,
  experimentIds,
} = {}) {
  return {
    snapshotId: snapshotId || null,
    libraryHash: libraryHash || null,
    packsHash: packsHash || null,
    paramsVersions: paramsVersions || {},
    packId: packId || null,
    cohortId: cohortId || null,
    experimentIds: Array.isArray(experimentIds) ? experimentIds : [],
  };
}
