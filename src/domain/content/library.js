import { workoutsSeed } from "./seeds/workouts.js";
import { nutritionSeed } from "./seeds/nutrition.js";
import { resetsSeed } from "./seeds/resets.js";

export const defaultLibrary = {
  workouts: workoutsSeed,
  nutrition: nutritionSeed,
  resets: resetsSeed,
};
