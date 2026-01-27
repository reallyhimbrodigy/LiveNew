const DAY_MS = 24 * 60 * 60 * 1000;

export function createTaskScheduler({
  config,
  createBackup,
  cleanupOldEvents,
  retentionDays,
  listAllUserStates,
  cleanupUserRetention,
  runEngineValidator,
  cleanupValidatorRuns,
}) {
  const running = new Set();
  const timers = [];

  async function runTask(name) {
    if (running.has(name)) return { ok: false, running: true };
    running.add(name);
    try {
      if (name === "backup") {
        const backup = await createBackup();
        return { ok: true, result: backup };
      }
      if (name === "cleanup") {
        await cleanupOldEvents(retentionDays);
        if (listAllUserStates && cleanupUserRetention) {
          const users = await listAllUserStates();
          for (const entry of users) {
            const policy = entry.state?.userProfile?.dataMinimization;
            if (policy?.enabled) {
              await cleanupUserRetention(entry.userId, policy);
            }
          }
        }
        return { ok: true };
      }
      if (name === "engine_validator") {
        if (typeof runEngineValidator !== "function") {
          return { ok: false, error: "validator_unavailable" };
        }
        const report = await runEngineValidator();
        if (typeof cleanupValidatorRuns === "function") {
          await cleanupValidatorRuns("engine_matrix", 30);
        }
        return { ok: true, result: report };
      }
      return { ok: false, error: "unknown_task" };
    } finally {
      running.delete(name);
    }
  }

  function schedule() {
    if (!(config.isAlphaLike || config.isProdLike)) return;
    timers.push(setInterval(() => runTask("backup").catch(() => {}), DAY_MS));
    timers.push(setInterval(() => runTask("cleanup").catch(() => {}), DAY_MS));
    timers.push(setInterval(() => runTask("engine_validator").catch(() => {}), DAY_MS));
  }

  function stop() {
    timers.forEach((timer) => clearInterval(timer));
    timers.length = 0;
  }

  return { runTask, schedule, stop };
}
