/** Calendar date (YYYY-MM-DD) in Asia/Manila (D-017). Due dates are plain dates in that calendar. */
export const SCHOOL_TZ = "Asia/Manila";

export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString("en-PH", { timeZone: SCHOOL_TZ, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
