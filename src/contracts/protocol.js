import { assertTodayContract } from "./todayContract.js";

export function assertTodayEnvelope(payload) {
  if (payload && typeof payload === "object" && payload.today) {
    return { today: assertTodayContract(payload.today) };
  }
  return { today: assertTodayContract(payload) };
}

export function unwrapTodayEnvelope(payload) {
  if (payload && typeof payload === "object" && payload.today) return payload.today;
  return payload;
}
