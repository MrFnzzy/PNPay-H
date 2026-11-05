/** Yearly student cohorts. A cohort starts every July and runs for 30 months (2.5 years). */
export const BATCHES = ["2026", "2027", "2028", "2029", "alumni"] as const;
export type Batch = string;
export const PLAN_MONTHS = 30;
export const COHORT_START_MONTH = 7;
export const COHORT_DURATION_MONTHS = 30;
export const BATCH_LABEL: Record<string, string> = { alumni: "Alumni" };

export const isBatch = (v: unknown): v is Batch => typeof v === "string" && (v === "alumni" || /^\d{4}$/.test(v));
export const batchLabel = (v: string | null | undefined) => !v ? "—" : v === "alumni" ? "Alumni" : /^\d{4}$/.test(v) ? `Batch ${v}` : "—";

/** The provided cohort convention: Batch 2027 starts in July 2025, so its cohort year is start year + 2. */
export function cohortStartDate(batch: string): string | null {
  if (!/^\d{4}$/.test(batch)) return null;
  return `${Number(batch) - 2}-${String(COHORT_START_MONTH).padStart(2, "0")}-01`;
}

export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

export function cohortAlumniDate(batch: string): string | null {
  const start = cohortStartDate(batch);
  return start ? addMonths(start, COHORT_DURATION_MONTHS) : null;
}

export function isRolloverDue(batch: string, today: string): boolean {
  const end = cohortAlumniDate(batch);
  return Boolean(end && today >= end);
}
