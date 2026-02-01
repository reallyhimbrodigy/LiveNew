function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    timezone: row.timezone || null,
    dayBoundaryMinute: Number.isFinite(Number(row.day_boundary_minute)) ? Number(row.day_boundary_minute) : null,
    constraints: row.constraints_json || null,
    consentAcceptedAt: row.consent_accepted_at || null,
    consentVersion: Number.isFinite(Number(row.consent_version)) ? Number(row.consent_version) : 0,
    onboardingCompletedAt: row.onboarding_completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeCheckinRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    dateKey: row.date_key,
    stress: row.stress ?? null,
    sleepQuality: row.sleep_quality ?? null,
    energy: row.energy ?? null,
    timeAvailableMin: row.time_available_min ?? null,
    raw: row.raw || null,
    createdAt: row.created_at || null,
  };
}

function normalizeEventRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    dateKey: row.date_key,
    type: row.type,
    idempotencyKey: row.idempotency_key || null,
    payload: row.payload || null,
    createdAt: row.created_at || null,
  };
}

function normalizeDerivedStateRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    dateKey: row.date_key,
    inputHash: row.input_hash,
    todayContract: row.today_contract || null,
    updatedAt: row.updated_at || null,
  };
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

export function createPersist(supabase) {
  if (!supabase) throw new Error("Supabase client required for persistence.");

  async function getOrCreateUserProfile(userId) {
    const { data, error } = await supabase
      .from("user_profile")
      .select(
        "user_id, timezone, day_boundary_minute, constraints_json, consent_accepted_at, consent_version, onboarding_completed_at, created_at, updated_at"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return normalizeProfileRow(data);
    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from("user_profile")
      .insert({ user_id: userId, created_at: now, updated_at: now })
      .select(
        "user_id, timezone, day_boundary_minute, constraints_json, consent_accepted_at, consent_version, onboarding_completed_at, created_at, updated_at"
      )
      .single();
    if (insertError) throw insertError;
    return normalizeProfileRow(inserted);
  }

  async function updateConsent(userId, { version, acceptedAt }) {
    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      consent_version: Number.isFinite(Number(version)) ? Number(version) : null,
      consent_accepted_at: acceptedAt || now,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("user_profile")
      .upsert(payload, { onConflict: "user_id" })
      .select(
        "user_id, timezone, day_boundary_minute, constraints_json, consent_accepted_at, consent_version, onboarding_completed_at, created_at, updated_at"
      )
      .single();
    if (error) throw error;
    return normalizeProfileRow(data);
  }

  async function updateOnboarding(userId, { timezone, dayBoundaryMinute, constraintsJson, completedAt }) {
    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      timezone: timezone || null,
      day_boundary_minute:
        Number.isFinite(Number(dayBoundaryMinute)) && Number(dayBoundaryMinute) >= 0 ? Number(dayBoundaryMinute) : null,
      constraints_json: constraintsJson || null,
      onboarding_completed_at: completedAt || now,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("user_profile")
      .upsert(payload, { onConflict: "user_id" })
      .select(
        "user_id, timezone, day_boundary_minute, constraints_json, consent_accepted_at, consent_version, onboarding_completed_at, created_at, updated_at"
      )
      .single();
    if (error) throw error;
    return normalizeProfileRow(data);
  }

  async function getCheckinByDateKey(userId, dateKey) {
    const { data, error } = await supabase
      .from("checkin")
      .select("user_id, date_key, stress, sleep_quality, energy, time_available_min, raw, created_at")
      .eq("user_id", userId)
      .eq("date_key", dateKey)
      .maybeSingle();
    if (error) throw error;
    return normalizeCheckinRow(data);
  }

  async function upsertCheckin(userId, dateKey, checkinPayload = {}) {
    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      date_key: dateKey,
      stress: checkinPayload?.stress ?? null,
      sleep_quality: checkinPayload?.sleepQuality ?? checkinPayload?.sleep ?? null,
      energy: checkinPayload?.energy ?? null,
      time_available_min: checkinPayload?.timeAvailableMin ?? checkinPayload?.timeMin ?? null,
      raw: checkinPayload || {},
      created_at: now,
    };
    const { data, error } = await supabase
      .from("checkin")
      .upsert(payload, { onConflict: "user_id,date_key" })
      .select("user_id, date_key, stress, sleep_quality, energy, time_available_min, raw, created_at")
      .single();
    if (error) throw error;
    return normalizeCheckinRow(data);
  }

  async function insertEventOncePerDay(userId, dateKey, type, payload, idempotencyKey = null) {
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      date_key: dateKey,
      type,
      idempotency_key: idempotencyKey,
      payload: payload || {},
      created_at: now,
    };
    const { data, error } = await supabase
      .from("event")
      .insert(row)
      .select("user_id, date_key, type, idempotency_key, payload, created_at")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        return { inserted: false };
      }
      throw error;
    }
    return { inserted: true, event: normalizeEventRow(data) };
  }

  async function insertEventIdempotent(userId, dateKey, type, idempotencyKey, payload) {
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      date_key: dateKey,
      type,
      idempotency_key: idempotencyKey,
      payload: payload || {},
      created_at: now,
    };
    const { data, error } = await supabase
      .from("event")
      .insert(row)
      .select("user_id, date_key, type, idempotency_key, payload, created_at")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        return { inserted: false };
      }
      throw error;
    }
    return { inserted: true, event: normalizeEventRow(data) };
  }

  async function listEvents(userId, fromKey, toKey) {
    let query = supabase
      .from("event")
      .select("user_id, date_key, type, idempotency_key, payload, created_at")
      .eq("user_id", userId);
    if (fromKey) query = query.gte("date_key", fromKey);
    if (toKey) query = query.lte("date_key", toKey);
    query = query.order("created_at", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data.map(normalizeEventRow) : [];
  }

  async function getDerivedState(userId) {
    const { data, error } = await supabase
      .from("derived_state")
      .select("user_id, date_key, input_hash, today_contract, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return normalizeDerivedStateRow(data);
  }

  async function upsertDerivedState(userId, dateKey, inputHash, todayContract) {
    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      date_key: dateKey,
      input_hash: inputHash,
      today_contract: todayContract,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("derived_state")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, date_key, input_hash, today_contract, updated_at")
      .single();
    if (error) throw error;
    return normalizeDerivedStateRow(data);
  }

  return {
    getOrCreateUserProfile,
    updateConsent,
    updateOnboarding,
    getCheckinByDateKey,
    upsertCheckin,
    insertEventOncePerDay,
    insertEventIdempotent,
    listEvents,
    getDerivedState,
    upsertDerivedState,
  };
}
