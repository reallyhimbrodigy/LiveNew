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
 * - preferredWorkoutWindows (array of "AM"|"MIDDAY"|"PM")
 * - busyDays (array of ISO dates within current week)
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
 * - days: [{dateISO, profile, focus, workout, nutrition, reset, rationale, workoutWindow, selectedNoveltyGroups}]
 *
 * Content items (workout/nutrition/reset) include:
 * - noveltyGroup (string)
 * - priority (1..5)
 */

/**
 * @typedef {Object} UserBaseline
 * @property {string} timezone
 * @property {number} dayBoundaryHour
 * @property {Object} [constraints]
 */

/**
 * @typedef {Object} DailyCheckIn
 * @property {string} dateISO
 * @property {number} stress
 * @property {number} sleepQuality
 * @property {number} energy
 * @property {number} timeAvailableMin
 * @property {{panic:boolean}=} safety
 */

/**
 * @typedef {Object} StressScores
 * @property {number} load
 * @property {number} capacity
 */

/**
 * @typedef {"WIRED"|"DEPLETED"|"RESTLESS"|"POOR_SLEEP"|"BALANCED"} StressProfile
 */

/**
 * @typedef {Object} ResetTool
 * @property {string} id
 * @property {string} title
 * @property {number} seconds
 * @property {{potency:string, context:string}} tags
 * @property {string[]} steps
 */

/**
 * @typedef {Object} Workout
 * @property {string} id
 * @property {string} title
 * @property {number} minutes
 * @property {number} intensity
 * @property {string[]} equipmentTags
 * @property {"downshift"|"neutral"|"upswing"} effect
 */

/**
 * @typedef {Object} NutritionPriority
 * @property {string} id
 * @property {string} title
 * @property {string[]} bullets
 * @property {string[]} timingTags
 */

/**
 * @typedef {Object} TodayContract
 * @property {true} ok
 * @property {string} dateISO
 * @property {StressProfile} profile
 * @property {StressScores} scores
 * @property {boolean} panicMode
 * @property {{id:string,title:string,seconds:number,steps:string[]}} reset
 * @property {null|{id:string,title:string,minutes:number,intensity:number,effect:string}} movement
 * @property {{id:string,title:string,bullets:string[]}} nutrition
 * @property {{bullets:string[]}} rationale
 * @property {{inputHash:string,version:string}} meta
 */
export {};
