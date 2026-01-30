function countDays(eventsByDateKey, type) {
  const keys = Object.keys(eventsByDateKey || {});
  let count = 0;
  keys.forEach((key) => {
    const events = eventsByDateKey[key] || [];
    if (events.some((event) => event?.type === type)) count += 1;
  });
  return count;
}

export function computeContinuityMeta({ dateKey, recentEventsByDateKey }) {
  const railOpenedDays = countDays(recentEventsByDateKey, "rail_opened");
  const resetCompletedDays = countDays(recentEventsByDateKey, "reset_completed");
  const checkinSubmittedDays = countDays(recentEventsByDateKey, "checkin_submitted");

  const notes = [];
  if (railOpenedDays > 0 && resetCompletedDays === 0) {
    notes.push("Reset-first can help re-anchor today.");
  }
  if (checkinSubmittedDays === 0) {
    notes.push("A quick check-in can tune today.");
  }

  return {
    dateKey,
    recent: {
      railOpenedDays,
      resetCompletedDays,
      checkinSubmittedDays,
    },
    notes,
  };
}
