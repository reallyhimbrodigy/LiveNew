import fs from "fs";

function percent(numerator, denominator) {
  if (!denominator) return null;
  const value = (numerator / denominator) * 100;
  return Math.round(value * 10) / 10;
}

function appendJsonLine(pathname, payload) {
  if (!pathname) return;
  try {
    fs.appendFileSync(pathname, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore log write failures
  }
}

export function createParityCounters({
  logEveryCount = 200,
  logIntervalMs = 5 * 60 * 1000,
  logFn = null,
  logPath = "",
} = {}) {
  const state = {
    checkinTotal: 0,
    checkinWithKey: 0,
    quickTotal: 0,
    quickWithKey: 0,
    todayTotal: 0,
    todayIfNoneMatch: 0,
    todayNotModified: 0,
    sinceLastLog: 0,
    lastLogAt: Date.now(),
  };

  function snapshot() {
    return {
      checkin: {
        total: state.checkinTotal,
        withKey: state.checkinWithKey,
        pctWithKey: percent(state.checkinWithKey, state.checkinTotal),
      },
      quick: {
        total: state.quickTotal,
        withKey: state.quickWithKey,
        pctWithKey: percent(state.quickWithKey, state.quickTotal),
      },
      today: {
        total: state.todayTotal,
        withIfNoneMatch: state.todayIfNoneMatch,
        pctIfNoneMatch: percent(state.todayIfNoneMatch, state.todayTotal),
        notModified: state.todayNotModified,
        pctNotModified: percent(state.todayNotModified, state.todayTotal),
      },
    };
  }

  function maybeLog(reason = "interval", force = false) {
    if (!logFn && !logPath) return;
    const now = Date.now();
    const dueByCount = logEveryCount > 0 && state.sinceLastLog >= logEveryCount;
    const dueByTime = logIntervalMs > 0 && now - state.lastLogAt >= logIntervalMs;
    if (!force && !dueByCount && !dueByTime) return;
    state.sinceLastLog = 0;
    state.lastLogAt = now;
    const payload = { event: "client_parity", reason, ...snapshot() };
    if (logFn) logFn(payload);
    if (logPath) appendJsonLine(logPath, payload);
  }

  function recordCheckin(hasKey) {
    state.checkinTotal += 1;
    if (hasKey) state.checkinWithKey += 1;
    state.sinceLastLog += 1;
    maybeLog("checkin");
  }

  function recordQuick(hasKey) {
    state.quickTotal += 1;
    if (hasKey) state.quickWithKey += 1;
    state.sinceLastLog += 1;
    maybeLog("quick");
  }

  function recordTodayRequest(hasIfNoneMatch) {
    state.todayTotal += 1;
    if (hasIfNoneMatch) state.todayIfNoneMatch += 1;
    state.sinceLastLog += 1;
    maybeLog("today");
  }

  function recordTodayNotModified() {
    state.todayNotModified += 1;
    state.sinceLastLog += 1;
    maybeLog("today_304");
  }

  function flush(reason = "flush") {
    maybeLog(reason, true);
  }

  return {
    recordCheckin,
    recordQuick,
    recordTodayRequest,
    recordTodayNotModified,
    snapshot,
    flush,
  };
}
