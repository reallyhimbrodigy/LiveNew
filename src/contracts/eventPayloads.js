const QUICK_SIGNALS = ["stressed", "exhausted", "ten_minutes", "more_energy"];

export const EVENT_PAYLOAD_SCHEMAS = {
  rail_opened: {
    required: { v: "number" },
    optional: {},
  },
  reset_completed: {
    required: { v: "number" },
    optional: { resetId: "string" },
  },
  checkin_submitted: {
    required: { v: "number", stress: "number", sleep: "number", energy: "number", timeMin: "number" },
    optional: {},
  },
  quick_adjusted: {
    required: { v: "number", signal: "string" },
    optional: {},
    enum: { signal: QUICK_SIGNALS },
  },
};

function hasUnexpectedKeys(payload, allowed) {
  if (!payload || typeof payload !== "object") return false;
  return Object.keys(payload).some((key) => !allowed.includes(key));
}

export function validateEventPayload(type, payload) {
  if (type === "rail_opened") {
    const allowed = ["v"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    const body = payload && typeof payload === "object" ? payload : {};
    return { ok: true, payload: { v: Number(body.v || 1) || 1 } };
  }
  if (type === "reset_completed") {
    if (!payload || typeof payload !== "object") return { ok: true, payload: { v: 1 } };
    const allowed = ["v", "resetId"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    if (payload.resetId && typeof payload.resetId !== "string") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "resetId invalid" } };
    }
    return {
      ok: true,
      payload: payload.resetId ? { v: 1, resetId: payload.resetId } : { v: 1 },
    };
  }
  if (type === "checkin_submitted") {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "checkin payload required" } };
    }
    const allowed = ["v", "stress", "sleep", "energy", "timeMin"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    const required = ["stress", "sleep", "energy", "timeMin"];
    for (const field of required) {
      const value = Number(payload[field]);
      if (!Number.isFinite(value)) {
        return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: `${field} invalid` } };
      }
    }
    if (payload.stress < 1 || payload.stress > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "stress out of range" } };
    }
    if (payload.sleep < 1 || payload.sleep > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "sleep out of range" } };
    }
    if (payload.energy < 1 || payload.energy > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "energy out of range" } };
    }
    if (payload.timeMin < 5 || payload.timeMin > 60) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "timeMin out of range" } };
    }
    return {
      ok: true,
      payload: {
        v: 1,
        stress: payload.stress,
        sleep: payload.sleep,
        energy: payload.energy,
        timeMin: payload.timeMin,
      },
    };
  }
  if (type === "quick_adjusted") {
    if (!payload || typeof payload !== "object" || typeof payload.signal !== "string") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "signal invalid" } };
    }
    const allowed = ["v", "signal"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    if (!QUICK_SIGNALS.includes(payload.signal)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "signal invalid" } };
    }
    return { ok: true, payload: { v: 1, signal: payload.signal } };
  }
  return { ok: true, payload: payload && typeof payload === "object" ? payload : {} };
}

export { QUICK_SIGNALS };
