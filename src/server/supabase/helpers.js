export function dayBoundaryHourFromMinute(dayBoundaryMinute) {
  const minute = Number(dayBoundaryMinute);
  if (!Number.isFinite(minute)) return null;
  return Math.max(0, Math.min(6, Math.floor(minute / 60)));
}

export function baselineFromSupabaseProfile(profile) {
  if (!profile) return null;
  const timezone = typeof profile.timezone === "string" ? profile.timezone.trim() : "";
  const boundaryMinute = Number(profile.dayBoundaryMinute);
  const dayBoundaryHour =
    Number.isFinite(boundaryMinute) && boundaryMinute >= 0 ? dayBoundaryHourFromMinute(boundaryMinute) : null;
  const constraints = profile.constraints && typeof profile.constraints === "object" ? profile.constraints : null;
  return {
    timezone,
    dayBoundaryHour,
    dayBoundaryMinute: Number.isFinite(boundaryMinute) ? boundaryMinute : null,
    constraints,
  };
}

export function supabaseProfileCompleteness(profile) {
  if (!profile) return { isComplete: false, missingFields: ["timezone", "dayBoundaryHour"] };
  const missingFields = [];
  if (!profile.timezone) missingFields.push("timezone");
  if (!Number.isFinite(Number(profile.dayBoundaryMinute))) missingFields.push("dayBoundaryHour");
  return { isComplete: missingFields.length === 0, missingFields };
}

export function supabaseConsentStatus(profile, requiredVersion) {
  const version = Number.isFinite(Number(profile?.consentVersion)) ? Number(profile.consentVersion) : 0;
  const acceptedAt = profile?.consentAcceptedAt || null;
  const consentComplete = Boolean(acceptedAt) && version >= requiredVersion;
  const accepted = {
    terms: consentComplete,
    privacy: consentComplete,
    alpha_processing: consentComplete,
  };
  return { accepted, consentComplete, version };
}

export function computeSupabaseUiState({
  isAuthenticated,
  consentComplete,
  consentVersionOk,
  profileComplete,
  onboardingComplete,
  canaryAllowed,
}) {
  if (!isAuthenticated) return "login";
  if (!consentComplete || !consentVersionOk) return "consent";
  if (!profileComplete || !onboardingComplete) return "onboard";
  if (!canaryAllowed) return "consent";
  return "home";
}
