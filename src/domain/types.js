/**
 * Domain type notes (JSDoc only, for documentation).
 *
 * UserProfile fields used by scoring:
 * - wakeTime, bedTime (HH:MM)
 * - sleepRegularity (1-10)
 * - caffeineCupsPerDay (0-5)
 * - lateCaffeineDaysPerWeek (0-7)
 * - sunlightMinutesPerDay (0..60)
 * - lateScreenMinutesPerNight (0..120)
 * - alcoholNightsPerWeek (0-7)
 * - mealTimingConsistency (1-10)
 *
 * DailyCheckIn:
 * - dateISO "YYYY-MM-DD"
 * - stress (1-10)
 * - sleepQuality (1-10)
 * - energy (1-10)
 * - timeAvailableMin (5|10|15|20|30|45|60)
 *
 * WeekPlan:
 * - startDateISO (Monday)
 * - days: [{dateISO, profile, focus, workout, nutrition, reset, rationale}]
 */
export {};
