export const DEFAULT_PARAMETERS = {
  profileThresholds: {
    loadBandHighMin: 70,
    loadBandMediumMin: 40,
    capacityBandHighMin: 70,
    capacityBandMediumMin: 40,
    sleepPoorMax: 4,
    stressHighMin: 7,
    energyLowMax: 4,
    stressAnxiousMin: 7,
    sleepAnxiousMin: 5,
    capacityHighMin: 70,
  },
  recoveryDebtWeights: {
    windowDays: 7,
    decayPerDay: 2,
    stressHighMin: 7,
    stressLowMax: 4,
    sleepLowMax: 5,
    sleepHighMin: 7,
    stressWeight: 4,
    sleepWeight: 4,
    goodDayBonus: 4,
    maxDebt: 100,
  },
  timeBuckets: {
    allowed: [5, 10, 15, 20, 30, 45, 60],
    default: 20,
  },
  focusBiasRules: {
    rebuildCapacityMin: 65,
    recoveryDebtBiasLow: 20,
    recoveryDebtBiasHigh: 35,
  },
  contentPackWeights: {
    calm_reset: {
      workoutTagWeights: { downshift: 3, stabilize: 1 },
      resetTagWeights: { downshift: 3, breathe: 1 },
      nutritionTagWeights: { sleep: 2, downshift: 2 },
    },
    balanced_routine: {
      workoutTagWeights: {},
      resetTagWeights: {},
      nutritionTagWeights: {},
    },
    rebuild_strength: {
      workoutTagWeights: { rebuild: 2, strength: 2 },
      resetTagWeights: { stabilize: 1 },
      nutritionTagWeights: { rebuild: 1 },
    },
  },
};
