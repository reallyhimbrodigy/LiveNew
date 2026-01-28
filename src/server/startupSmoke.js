export function scheduleStartupSmoke({
  enabled,
  delayMs = 3000,
  runReady,
  runBootstrap,
  onResult,
  log,
}) {
  if (!enabled) return;
  let ran = false;
  setTimeout(async () => {
    if (ran) return;
    ran = true;
    let ok = true;
    let errorCode = null;
    try {
      await runReady();
    } catch (err) {
      ok = false;
      errorCode = err?.code || "readyz_failed";
    }
    try {
      await runBootstrap();
    } catch (err) {
      ok = false;
      if (!errorCode) errorCode = err?.code || "bootstrap_failed";
    }
    if (typeof onResult === "function") {
      await onResult({ ok, errorCode });
    }
    if (!ok && typeof log === "function") {
      log({ event: "startup_smoke_failed", errorCode });
    }
  }, delayMs);
}
