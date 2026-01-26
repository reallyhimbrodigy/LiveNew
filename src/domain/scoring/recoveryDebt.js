export function computeRecoveryDebt(checkInsByDate, dateISO) {
  if (!checkInsByDate) return 0;
  const dates = Object.keys(checkInsByDate)
    .filter((d) => d <= dateISO)
    .sort();
  const recent = dates.slice(-7);
  let debt = 0;
  recent.forEach((d) => {
    debt = Math.max(0, debt - 2);
    const checkIn = checkInsByDate[d];
    if (!checkIn) return;
    const stress = Number(checkIn.stress || 5);
    const sleep = Number(checkIn.sleepQuality || 6);
    if (stress >= 7) debt += (stress - 6) * 4;
    if (sleep <= 5) debt += (6 - sleep) * 4;
    if (stress <= 4 && sleep >= 7) debt = Math.max(0, debt - 4);
  });
  return Math.min(100, Math.round(Math.max(0, debt)));
}
