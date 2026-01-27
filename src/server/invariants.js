import { AppError } from "./errors.js";

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertDayContract(day) {
  if (!isObject(day)) {
    throw new AppError("invalid_day_contract", "Day plan missing", 500, "day");
  }
  if (!isString(day.dateISO)) {
    throw new AppError("invalid_day_contract", "dateISO missing", 500, "dateISO");
  }
  if (!isObject(day.what) || !isObject(day.why)) {
    throw new AppError("invalid_day_contract", "Day contract incomplete", 500, "day");
  }
  if (!isObject(day.howLong) || !isObject(day.details)) {
    throw new AppError("invalid_day_contract", "Day contract timing/details missing", 500, "day");
  }
}

export function assertWeekPlan(weekPlan) {
  if (!isObject(weekPlan)) {
    throw new AppError("invalid_week_plan", "Week plan missing", 500, "weekPlan");
  }
  if (!isString(weekPlan.startDateISO)) {
    throw new AppError("invalid_week_plan", "Week start missing", 500, "startDateISO");
  }
  if (!Array.isArray(weekPlan.days) || weekPlan.days.length < 1) {
    throw new AppError("invalid_week_plan", "Week days missing", 500, "days");
  }
  weekPlan.days.forEach((day) => {
    if (!isString(day?.dateISO)) {
      throw new AppError("invalid_week_plan", "Day date missing", 500, "days");
    }
  });
}

