const RELATIVE_UNITS: [limitSeconds: number, divisor: number, unit: string][] = [
  [60, 1, "s"],
  [3600, 60, "m"],
  [86400, 3600, "h"],
  [604800, 86400, "d"],
];

/** Compact relative time ("3h", "2d") for card timestamps. */
export function relativeTime(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);
  for (const [limit, divisor, unit] of RELATIVE_UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${unit}`;
  }
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
