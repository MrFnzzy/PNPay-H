/** Yearly student cohorts begin every July; their 30-month rollover lifecycle is separate from payment duration. */
/**
 * The batches that exist on day one. The live list is a rolling window kept by the administrator (see lib/batch-window.ts):
 * a new yearly batch is added only after the admin approves it, and the oldest one leaves (moves to Alumni) only after the admin
 * approves its 30-month rollover. Nothing changes by itself.
 */
export const INITIAL_BATCHES = ["2026", "2027", "2028"] as const;
export type Batch = string;
export const PLAN_MONTHS = 24;
/** Hard cap: no student may ever hold more than this many installments in total (any period, any way they were created). */
export const MAX_INSTALLMENTS_PER_STUDENT = 24;
export const COHORT_START_MONTH = 7;
export const COHORT_DURATION_MONTHS = 30;
export const batchOptionLabel = (v: string) => (v === "alumni" ? "Alumni" : v);

/** Format check only (a four-digit cohort year or "alumni"). Whether the batch is currently OPEN is decided by the batch window. */
export const isBatch = (v: unknown): v is Batch => typeof v === "string" && (v === "alumni" || (/^\d{4}$/.test(v) && Number(v) >= 2026 && Number(v) <= 2100));
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

/** Active numeric batches = (initial + admin-opened) minus the batches whose rollover to Alumni was approved. Sorted ascending. */
export function computeActiveBatches(opened: readonly string[], retired: readonly string[]): string[] {
  const gone = new Set(retired);
  return [...new Set<string>([...INITIAL_BATCHES, ...opened])].filter((b) => !gone.has(b)).sort();
}

/** The next yearly batch that could be opened: one year after the highest batch ever known. */
export function nextBatchCandidate(opened: readonly string[], retired: readonly string[]): string {
  const years = [...INITIAL_BATCHES, ...opened, ...retired].map(Number).filter(Number.isFinite);
  return String(Math.max(...years) + 1);
}

/** A new batch is due for approval once its cohort start (July, two years before its label) has arrived. */
export function isNewBatchDue(batch: string, today: string): boolean {
  const start = cohortStartDate(batch);
  return Boolean(start && today >= start);
}
