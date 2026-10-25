export function deviceRetryDelay(attempt: number, random = Math.random): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(0, attempt), 6));
  return Math.min(60_000, Math.round(base * (0.8 + random() * 0.4)));
}
