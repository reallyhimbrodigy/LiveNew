/**
 * Returns today's date as YYYY-MM-DD in the device's local timezone.
 * This matches the server's date key logic (which uses the user's timezone)
 * and avoids the UTC mismatch from toISOString().slice(0, 10).
 */
export function getLocalDateISO(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns yesterday's date as YYYY-MM-DD in local timezone.
 */
export function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateISO(d);
}
