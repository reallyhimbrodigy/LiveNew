export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const round1 = (n) => Math.round(n * 10) / 10;
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
