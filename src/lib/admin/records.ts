import { and, asc, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { addDays, isRealDate, manilaToday } from "@/lib/payments/dates";
import { toCents } from "@/lib/payments/money";
import type { InstallmentStatus, SubmissionStatus } from "@/lib/payments/status";

const { paymentObligations: ob, paymentSubmissions: sub, users } = schema;

/**
 * SECURITY: every function here is for the administrator only. Callers MUST have passed requireRole("admin")
 * (pages) - the guard is not repeated per query because none of these functions accepts an actor from the request.
 * All user input reaches SQL only as bound parameters; sort columns come from a fixed whitelist. These functions
 * are read-only: filtering and sorting can never change a status or a receipt.
 */

export const RECORDS_PAGE_SIZE = 25;
export const UPCOMING_WINDOW_DAYS = 30; // D-035
export const SORTS = ["due_date", "student_name", "submission_date"] as const;
export type RecordSort = (typeof SORTS)[number];
export const SUBMISSION_FILTERS = ["pending_review", "verified", "needs_correction", "rejected", "none"] as const;
export const INSTALLMENT_FILTERS = ["not_yet_due", "pending_verification", "paid", "requires_resubmission", "overdue"] as const;

export interface RecordFilters {
  q?: string;
  yearLevel?: number;
  /** YYYY-MM of the installment DUE date (D-033). */
  month?: string;
  /** Date range applied to the latest submission's payment date (D-033). */
  payFrom?: string;
  payTo?: string;
  submission?: (typeof SUBMISSION_FILTERS)[number];
  installment?: InstallmentStatus;
  sort: RecordSort;
  dir: "asc" | "desc";
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Validates search params. Invalid values are dropped (never trusted) and reported so the page can say so. */
export function parseRecordFilters(sp: Raw): { filters: RecordFilters; errors: string[] } {
  const errors: string[] = [];
  const f: RecordFilters = { sort: "due_date", dir: "asc", page: 1 };

  const q = first(sp.q)?.trim();
  if (q) {
    if (q.length > 100) errors.push("The search text is too long (100 characters maximum).");
    else f.q = q;
  }
  const yl = first(sp.yearLevel);
  if (yl) {
    const n = Number(yl);
    if (Number.isInteger(n) && n >= 1 && n <= 6) f.yearLevel = n;
    else errors.push("Year level must be between 1 and 6.");
  }
  const month = first(sp.month);
  if (month) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) f.month = month;
    else errors.push("Choose a valid month.");
  }
  const from = first(sp.payFrom);
  const to = first(sp.payTo);
  const fromOk = from ? isRealDate(from) : undefined;
  const toOk = to ? isRealDate(to) : undefined;
  if (from && !fromOk) errors.push("The payment date range start is not a valid date.");
  if (to && !toOk) errors.push("The payment date range end is not a valid date.");
  if (fromOk && toOk && from! > to!) errors.push("The payment date range start must not be after its end.");
  else {
    if (fromOk) f.payFrom = from;
    if (toOk) f.payTo = to;
  }
  const submission = first(sp.submission);
  if (submission) {
    if ((SUBMISSION_FILTERS as readonly string[]).includes(submission)) f.submission = submission as RecordFilters["submission"];
    else errors.push("Unknown receipt status filter.");
  }
  const installment = first(sp.installment);
  if (installment) {
    if ((INSTALLMENT_FILTERS as readonly string[]).includes(installment)) f.installment = installment as InstallmentStatus;
    else errors.push("Unknown installment status filter.");
  }
  const sort = first(sp.sort);
  if (sort) {
    if ((SORTS as readonly string[]).includes(sort)) f.sort = sort as RecordSort;
    else errors.push("Unknown sort column.");
  }
  const dir = first(sp.dir);
  if (dir) {
    if (dir === "asc" || dir === "desc") f.dir = dir;
    else errors.push("Unknown sort direction.");
  }
  const page = first(sp.page);
  if (page) {
    const n = Number(page);
    if (Number.isInteger(n) && n >= 1 && n <= 100000) f.page = n;
    else errors.push("Invalid page number.");
  }
  return { filters: f, errors };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const nextMonthFirst = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Latest submission per installment, as a subquery. */
function latestSubmissions() {
  return getDb()
    .selectDistinctOn([sub.obligationId], {
      submissionId: sub.submissionId,
      obligationId: sub.obligationId,
      status: sub.status,
      submittedAt: sub.submittedAt,
      paymentDate: sub.paymentDate,
    })
    .from(sub)
    .orderBy(sub.obligationId, desc(sub.submittedAt), desc(sub.submissionId))
    .as("ls");
}

/**
 * SQL twin of deriveInstallmentStatus() in src/lib/payments/status.ts (paid > pending > needs-correction > due date).
 * tests/admin.test.ts proves the two agree for every status.
 */
function installmentStatusSql(ls: ReturnType<typeof latestSubmissions>, today: string): SQL<InstallmentStatus> {
  return sql<InstallmentStatus>`CASE
    WHEN EXISTS (SELECT 1 FROM payment_submissions v WHERE v.obligation_id = ${ob.obligationId} AND v.status = 'verified') THEN 'paid'
    WHEN EXISTS (SELECT 1 FROM payment_submissions p WHERE p.obligation_id = ${ob.obligationId} AND p.status = 'pending_review') THEN 'pending_verification'
    WHEN ${ls.status} = 'needs_correction' THEN 'requires_resubmission'
    WHEN ${ob.dueDate} < ${today}::date THEN 'overdue'
    ELSE 'not_yet_due' END`;
}

export interface RecordRow {
  obligationId: string;
  studentId: string;
  studentName: string;
  studentCode: string | null;
  yearLevel: number | null;
  academicYear: string;
  periodLabel: string;
  amountCents: number;
  dueDate: string;
  installmentStatus: InstallmentStatus;
  submissionId: string | null;
  submissionStatus: SubmissionStatus | null;
  submittedAt: Date | null;
  paymentDate: string | null;
}

function build(today: string) {
  const ls = latestSubmissions();
  const status = installmentStatusSql(ls, today);
  const db = getDb();
  const rows = (where: SQL | undefined, order: SQL[], limit: number, offset: number) =>
    db
      .select({
        obligationId: ob.obligationId,
        studentId: users.userId,
        studentName: users.fullName,
        studentCode: users.studentId,
        yearLevel: users.yearLevel,
        academicYear: ob.academicYear,
        periodLabel: ob.periodLabel,
        amount: ob.amountDue,
        dueDate: ob.dueDate,
        installmentStatus: status,
        submissionId: ls.submissionId,
        submissionStatus: ls.status,
        submittedAt: ls.submittedAt,
        paymentDate: ls.paymentDate,
      })
      .from(ob)
      .innerJoin(users, eq(users.userId, ob.studentId))
      .leftJoin(ls, eq(ls.obligationId, ob.obligationId))
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset);
  const count = (where: SQL | undefined) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ob)
      .innerJoin(users, eq(users.userId, ob.studentId))
      .leftJoin(ls, eq(ls.obligationId, ob.obligationId))
      .where(where);
  return { ls, status, rows, count };
}

const mapRow = (r: Awaited<ReturnType<ReturnType<typeof build>["rows"]>>[number]): RecordRow => ({
  obligationId: r.obligationId,
  studentId: r.studentId,
  studentName: r.studentName,
  studentCode: r.studentCode,
  yearLevel: r.yearLevel,
  academicYear: r.academicYear,
  periodLabel: r.periodLabel,
  amountCents: toCents(r.amount),
  dueDate: r.dueDate,
  installmentStatus: r.installmentStatus,
  submissionId: r.submissionId,
  submissionStatus: r.submissionStatus,
  submittedAt: r.submittedAt,
  paymentDate: r.paymentDate,
});

/** LLD 8.2 - combinable filters, whitelisted sorting, pagination. Read-only. */
export async function listRecords(f: RecordFilters, today = manilaToday()) {
  const { ls, status, rows, count } = build(today);
  const conds: (SQL | undefined)[] = [];
  if (f.q) {
    const pat = `%${escapeLike(f.q)}%`;
    conds.push(or(ilike(users.fullName, pat), ilike(users.studentId, pat)));
  }
  if (f.yearLevel) conds.push(eq(users.yearLevel, f.yearLevel));
  if (f.month) conds.push(and(gte(ob.dueDate, `${f.month}-01`), lt(ob.dueDate, nextMonthFirst(f.month))));
  if (f.payFrom) conds.push(gte(ls.paymentDate, f.payFrom));
  if (f.payTo) conds.push(sql`${ls.paymentDate} <= ${f.payTo}`);
  if (f.submission === "none") conds.push(isNull(ls.submissionId));
  else if (f.submission) conds.push(eq(ls.status, f.submission));
  if (f.installment) conds.push(sql`${status} = ${f.installment}`);
  const where = conds.length ? and(...conds) : undefined;

  const dirFn = f.dir === "desc" ? desc : asc;
  const tie = [asc(ob.dueDate), asc(users.fullName), asc(ob.obligationId)];
  const order: SQL[] =
    f.sort === "student_name"
      ? [dirFn(users.fullName), dirFn(users.studentId), ...tie]
      : f.sort === "submission_date"
        ? [f.dir === "desc" ? sql`${ls.submittedAt} desc nulls last` : sql`${ls.submittedAt} asc nulls last`, ...tie]
        : [dirFn(ob.dueDate), asc(users.fullName), asc(ob.obligationId)];

  const [{ n: total }] = await count(where);
  const pages = Math.max(1, Math.ceil(total / RECORDS_PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const data = await rows(where, order, RECORDS_PAGE_SIZE, (page - 1) * RECORDS_PAGE_SIZE);
  return { rows: data.map(mapRow), total, page, pages };
}

/** LLD 8.1 - every number comes from the database (nothing hardcoded). */
export async function getAdminDashboard(today = manilaToday()) {
  const db = getDb();
  const { status, rows, count } = build(today);

  const byStatus = await db.select({ status: sub.status, n: sql<number>`count(*)::int` }).from(sub).groupBy(sub.status);
  const n = (s: SubmissionStatus) => byStatus.find((r) => r.status === s)?.n ?? 0;
  const [{ students, installments }] = await db
    .select({ students: sql<number>`count(distinct ${ob.studentId})::int`, installments: sql<number>`count(*)::int` })
    .from(ob);

  const overdueWhere = sql`(${status} = 'overdue' OR (${status} = 'requires_resubmission' AND ${ob.dueDate} < ${today}::date))`;
  const upcomingWhere = and(sql`${status} <> 'paid'`, sql`${ob.dueDate} >= ${today}::date`, sql`${ob.dueDate} <= ${addDays(today, UPCOMING_WINDOW_DAYS)}::date`);
  const [[{ n: overdueCount }], overdue, [{ n: upcomingCount }], upcoming] = await Promise.all([
    count(overdueWhere),
    rows(overdueWhere, [asc(ob.dueDate), asc(users.fullName)], 10, 0),
    count(upcomingWhere),
    rows(upcomingWhere, [asc(ob.dueDate), asc(users.fullName)], 10, 0),
  ]);

  const recent = await db
    .select({
      submissionId: sub.submissionId,
      studentName: users.fullName,
      studentCode: users.studentId,
      periodLabel: ob.periodLabel,
      status: sub.status,
      submittedAt: sub.submittedAt,
      reviewedAt: sub.reviewedAt,
    })
    .from(sub)
    .innerJoin(users, eq(users.userId, sub.studentId))
    .innerJoin(ob, eq(ob.obligationId, sub.obligationId))
    .orderBy(desc(sub.submittedAt))
    .limit(10);
  const pending = await db
    .select({ submissionId: sub.submissionId, studentName: users.fullName, studentCode: users.studentId, periodLabel: ob.periodLabel, submittedAt: sub.submittedAt })
    .from(sub)
    .innerJoin(users, eq(users.userId, sub.studentId))
    .innerJoin(ob, eq(ob.obligationId, sub.obligationId))
    .where(eq(sub.status, "pending_review"))
    .orderBy(asc(sub.submittedAt))
    .limit(10);

  return {
    totalSubmissions: byStatus.reduce((a, r) => a + r.n, 0),
    pending: n("pending_review"),
    verified: n("verified"),
    needsCorrection: n("needs_correction"),
    rejected: n("rejected"),
    students,
    installments,
    overdueCount,
    overdue: overdue.map(mapRow),
    upcomingCount,
    upcoming: upcoming.map(mapRow),
    recent,
    pendingQueue: pending,
  };
}

/** Distinct academic years present in the schedule (for filters/forms). */
export async function listAcademicYears(): Promise<string[]> {
  const r = await getDb().selectDistinct({ y: ob.academicYear }).from(ob).orderBy(desc(ob.academicYear));
  return r.map((x) => x.y);
}

export const studentIdParam = z.string().uuid();

/** Student header for the admin's per-student page. Returns null unless the id belongs to a STUDENT account. */
export async function getStudentHeader(studentId: string) {
  if (!studentIdParam.safeParse(studentId).success) return null;
  const [u] = await getDb()
    .select({ userId: users.userId, fullName: users.fullName, studentId: users.studentId, email: users.email, course: users.course, yearLevel: users.yearLevel, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.userId, studentId), eq(users.role, "student")));
  return u ?? null;
}
