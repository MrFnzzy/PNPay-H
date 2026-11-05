import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { manilaToday } from "./dates";
import { toCents } from "./money";
import { countsAsOverdue, deriveInstallmentStatus, type InstallmentStatus, type SubmissionStatus } from "./status";

const { paymentObligations: ob, paymentSubmissions: sub, notifications } = schema;

/**
 * SECURITY: every function here takes `studentId` and puts it in the WHERE clause of every query.
 * Callers pass the id from the authenticated session - never from a URL, form or request body.
 */

export interface Installment {
  obligationId: string;
  academicYear: string;
  periodLabel: string;
  amountCents: number;
  dueDate: string;
  status: InstallmentStatus;
  overdueCounted: boolean;
  latestSubmission: { submissionId: string; status: SubmissionStatus; submittedAt: Date; remarks: string | null } | null;
}

export async function getInstallments(studentId: string, today = manilaToday()): Promise<Installment[]> {
  const db = getDb();
  const obligations = await db.select().from(ob).where(eq(ob.studentId, studentId)).orderBy(ob.dueDate, ob.periodLabel);
  const subs = await db
    .select({ submissionId: sub.submissionId, obligationId: sub.obligationId, status: sub.status, submittedAt: sub.submittedAt, remarks: sub.remarks })
    .from(sub)
    .where(eq(sub.studentId, studentId))
    .orderBy(desc(sub.submittedAt));
  return obligations.map((o) => {
    const mine = subs.filter((s) => s.obligationId === o.obligationId);
    const status = deriveInstallmentStatus(o.dueDate, today, mine);
    const latest = mine[0] ?? null;
    return {
      obligationId: o.obligationId,
      academicYear: o.academicYear,
      periodLabel: o.periodLabel,
      amountCents: toCents(o.amountDue),
      dueDate: o.dueDate,
      status,
      overdueCounted: countsAsOverdue(status, o.dueDate, today),
      latestSubmission: latest ? { submissionId: latest.submissionId, status: latest.status, submittedAt: latest.submittedAt, remarks: latest.remarks } : null,
    };
  });
}

export interface TransactionRow {
  submissionId: string;
  periodLabel: string;
  academicYear: string;
  amountCents: number;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string | null;
  status: SubmissionStatus;
  remarks: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  receiptMime: string;
  receiptSize: number;
}

async function transactions(studentId: string, limit: number, offset = 0): Promise<TransactionRow[]> {
  const rows = await getDb()
    .select({
      submissionId: sub.submissionId,
      periodLabel: ob.periodLabel,
      academicYear: ob.academicYear,
      amount: sub.amountSubmitted,
      paymentDate: sub.paymentDate,
      paymentMethod: sub.paymentMethod,
      referenceNumber: sub.referenceNumber,
      status: sub.status,
      remarks: sub.remarks,
      submittedAt: sub.submittedAt,
      reviewedAt: sub.reviewedAt,
      receiptMime: sub.receiptMime,
      receiptSize: sub.receiptSize,
    })
    .from(sub)
    .innerJoin(ob, eq(ob.obligationId, sub.obligationId))
    .where(eq(sub.studentId, studentId))
    .orderBy(desc(sub.submittedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(({ amount, ...r }) => ({ ...r, amountCents: toCents(amount) }));
}

export const getRecentTransactions = (studentId: string, limit = 5) => transactions(studentId, limit);

export const HISTORY_PAGE_SIZE = 20;

export async function getPaymentHistory(studentId: string, page = 1) {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(sub).where(eq(sub.studentId, studentId));
  const rows = await transactions(studentId, HISTORY_PAGE_SIZE, (p - 1) * HISTORY_PAGE_SIZE);
  return { rows, page: p, total: n, pages: Math.max(1, Math.ceil(n / HISTORY_PAGE_SIZE)) };
}

export interface MonthSummary {
  month: string; // YYYY-MM of the due date
  dueCents: number;
  paidCents: number;
  installments: number;
}

export async function getDashboard(studentId: string, today = manilaToday()) {
  const installments = await getInstallments(studentId, today);
  const totalCents = installments.reduce((n, i) => n + i.amountCents, 0);
  const paidCents = installments.filter((i) => i.status === "paid").reduce((n, i) => n + i.amountCents, 0);
  const remainingCents = totalCents - paidCents;
  // Zero obligations -> 0% (no division by zero).
  const progressPercent = totalCents > 0 ? Math.round((paidCents / totalCents) * 1000) / 10 : 0;
  const overdueCount = installments.filter((i) => i.overdueCounted).length;
  const upcoming = installments.filter((i) => i.status !== "paid" && i.dueDate >= today).slice(0, 5);

  const byMonth = new Map<string, MonthSummary>();
  for (const i of installments) {
    const m = i.dueDate.slice(0, 7);
    const row = byMonth.get(m) ?? { month: m, dueCents: 0, paidCents: 0, installments: 0 };
    row.dueCents += i.amountCents;
    if (i.status === "paid") row.paidCents += i.amountCents;
    row.installments += 1;
    byMonth.set(m, row);
  }

  return {
    totalCents,
    paidCents,
    remainingCents,
    progressPercent,
    overdueCount,
    installmentCount: installments.length,
    upcoming,
    monthly: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    installments,
    recent: await getRecentTransactions(studentId, 5),
    unreadNotifications: await getUnreadCount(studentId),
  };
}

/** Receipt metadata for retrieval - only if the submission belongs to this student. */
export async function getOwnedReceipt(studentId: string, submissionId: string) {
  const [row] = await getDb()
    .select({ key: sub.receiptKey, mime: sub.receiptMime, size: sub.receiptSize })
    .from(sub)
    .where(and(eq(sub.submissionId, submissionId), eq(sub.studentId, studentId)));
  return row ?? null;
}

/* ------------------------------------------------------------------ notifications */

export async function getUnreadCount(studentId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, studentId), eq(notifications.isRead, false)));
  return r?.n ?? 0;
}

export async function getNotifications(studentId: string, limit = 50) {
  return getDb()
    .select({
      notificationId: notifications.notificationId,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      submissionId: notifications.submissionId,
      obligationId: notifications.obligationId,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, studentId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** Returns true if a notification owned by this student was updated. */
export async function markNotificationRead(studentId: string, notificationId: string): Promise<boolean> {
  const res = await getDb()
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.notificationId, notificationId), eq(notifications.userId, studentId), eq(notifications.isRead, false)))
    .returning({ id: notifications.notificationId });
  return res.length > 0;
}

export async function markAllNotificationsRead(studentId: string): Promise<number> {
  const res = await getDb()
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, studentId), eq(notifications.isRead, false)))
    .returning({ id: notifications.notificationId });
  return res.length;
}
