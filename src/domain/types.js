/**
 * @typedef {"AM" | "MIDDAY" | "PM" | "NIGHT"} StressWindow
 */

/**
 * @typedef {Object} Baseline
 * @property {number} sleepHours
 * @property {number} caffeineCups
 * @property {number} workoutsPerWeek
 * @property {number} perceivedStress
 * @property {string} wakeTime
 * @property {string} bedtime
 * @property {number} lateScreenMins
 * @property {number} alcoholNightsPerWeek
 * @property {number} sunlightMinsPerDay
 * @property {number} mealTimingConsistency
 * @property {number} lateCaffeineDaysPerWeek
 * @property {number} sleepRegularity
 * @property {{ calmer: boolean, energy: boolean, digestion: boolean, focus: boolean }} goals
 * @property {{ timePerDayMin: number, dietaryStyle: "none" | "balanced" | "low_carb" | "mediterranean" | "plant_forward" }} constraints
 */

/**
 * @typedef {Object} DailyCheckIn
 * @property {string} dateISO
 * @property {number} stress
 * @property {number} sleepQuality
 * @property {number} energy
 * @property {number} cravings
 * @property {string} [notes]
 */

/**
 * @typedef {Object} ProtocolBlock
 * @property {string} id
 * @property {StressWindow} window
 * @property {string} title
 * @property {number} minutes
 * @property {string[]} instructions
 * @property {Array<"breath" | "movement" | "food" | "light" | "sleep" | "recovery">} tags
 */

/**
 * @typedef {Object} DayPlan
 * @property {string} dateISO
 * @property {ProtocolBlock[]} blocks
 * @property {"downshift" | "stabilize" | "rebuild"} focus
 */

/**
 * @typedef {Object} WeekPlan
 * @property {string} startDateISO
 * @property {DayPlan[]} days
 * @property {number} version
 */

export {};
