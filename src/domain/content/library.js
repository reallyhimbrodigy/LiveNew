import { workoutsSeed } from "./seeds/workouts";
import { nutritionSeed } from "./seeds/nutrition";
import { resetsSeed } from "./seeds/resets";

export const defaultLibrary = {
  workouts: workoutsSeed,
  nutrition: nutritionSeed,
  resets: resetsSeed,
};
