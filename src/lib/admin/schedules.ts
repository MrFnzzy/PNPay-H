import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { UserFacingError, pgErrorInfo } from "@/lib/errors";
import { isRealDate, manilaToday } from "@/lib/payments/dates";
import { STANDARD_INSTALLMENT_AMOUNT, toCents } from "@/lib/payments/money";
import { deriveInstallmentStatus, type InstallmentStatus } from "@/lib/payments/status";
import { assertAdmin } from "./review";

const { paymentObligations: ob, paymentSubmissions: sub, receiptUploadIntents: intents, users, adminAuditEvents } = schema;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/* ------------------------------------------------------------------ validation */

export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, "Academic year must look like 2026-2027.")
  .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, "The second year must follow the first (for example 2026-2027).");

export const periodLabelSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Enter the installment period (for example November 2026).").max(50, "The installment period must be 50 characters or fewer."));

export const dueDateSchema = z
  .string()
  .refine(isRealDate, "Enter a valid due date.")
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "The due date is out of range.");

export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter the amount in pesos, for example 500.00.")
  .transform((v) => Number(v).toFixed(2))
  .refine((v) => Number(v) > 0, "The amount must be greater than zero.")
  .refine((v) => Number(v) <= 100000, "The amount is too large.");

const noteSchema = z
  .string()
  .trim()
  .max(300, "The note must be 300 characters or fewer.")
  .optional()
  .transform((v) => (v ? v : undefined));

export const SCOPES = ["all", "year_level", "student"] as const;

const needsNote = (amount: string, note: string | undefined, ctx: z.RefinementCtx) => {
  if (amount !== STANDARD_INSTALLMENT_AMOUNT && (note?.length ?? 0) < 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountNote"], message: "A non-standard amount needs a short note explaining the approved requirement (at least 5 characters)." });
  }
};

const createSchema = z
  .object({
    academicYear: academicYearSchema,
    periodLabel: periodLabelSchema,
    dueDate: dueDateSchema,
    amount: amountSchema,
    amountNote: noteSchema,
    scope: z.enum(SCOPES, { errorMap: () => ({ message: "Choose who the installment is for." }) }),
    yearLevel: z.coerce.number().int().min(1).max(6).optional(),
    studentCode: z.string().trim().max(30).optional(),
  })
  .superRefine((v, ctx) => {
    needsNote(v.amount, v.amountNote, ctx);
    if (v.scope === "year_level" && !v.yearLevel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["yearLevel"], message: "Choose a year level." });
    if (v.scope === "student" && !v.studentCode) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["studentCode"], message: "Enter the student ID." });
  });

const updateSchema = z
  .object({ academicYear: academicYearSchema, periodLabel: periodLabelSchema, dueDate: dueDateSchema, amount: amountSchema, amountNote: noteSchema })
  .superRefine((v, ctx) => needsNote(v.amount, v.amountNote, ctx));

const firstIssue = (e: z.ZodError) => new UserFacingError(e.issues[0]?.message ?? "Please check the form.", "invalid_input", 422);

async function audit(tx: Tx, adminId: string, action: string, entityId: string | null, details: Record<string, unknown>, entityType = "obligation") {
  await tx.insert(adminAuditEvents).values({ adminId, action, entityType, entityId, details });
}

/* ------------------------------------------------------------------ create (LLD 8.3: createPaymentSchedule + assignInstallmentsToStudents) */

export interface CreateResult {
  targets: number;
  created: number;
  skippedDuplicates: number;
}

/**
 * Creates one installment period for the chosen students in ONE transaction. A student who already has that
 * period (case-insensitive, same academic year) is skipped, never duplicated or overwritten (D-032).
 */
export async function createSchedule(adminId: string, raw: Record<string, unknown>): Promise<CreateResult> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) throw firstIssue(parsed.error);
  const v = parsed.data;

  return getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const base = and(eq(users.role, "student"), eq(users.isActive, true));
    let targets: { userId: string }[];
    if (v.scope === "student") {
      targets = await tx
        .select({ userId: users.userId })
        .from(users)
        .where(and(base, eq(users.studentId, v.studentCode!.toUpperCase())));
      if (targets.length === 0) throw new UserFacingError("No active student has that student ID.", "student_not_found", 404);
    } else if (v.scope === "year_level") {
      targets = await tx.select({ userId: users.userId }).from(users).where(and(base, eq(users.yearLevel, v.yearLevel!)));
    } else {
      targets = await tx.select({ userId: users.userId }).from(users).where(base);
    }
    if (targets.length === 0) throw new UserFacingError("No active students match that selection.", "no_targets", 422);

    let created = 0;
    for (let i = 0; i < targets.length; i += 500) {
      const chunk = targets.slice(i, i + 500).map((t) => ({ studentId: t.userId, academicYear: v.academicYear, periodLabel: v.periodLabel, amountDue: v.amount, dueDate: v.dueDate }));
      // No conflict target: skips a duplicate on EITHER unique index (exact or case-insensitive period).
      const res = await tx.insert(ob).values(chunk).onConflictDoNothing().returning({ id: ob.obligationId });
      created += res.length;
    }
    const skipped = targets.length - created;
    if (created === 0) {
      throw new UserFacingError(
        targets.length === 1 ? "That student already has this installment period for the academic year." : "Every selected student already has this installment period for the academic year.",
        "duplicate_obligation",
        409,
      );
    }
    await audit(
      tx,
      adminId,
      "schedule_created",
      null,
      { academicYear: v.academicYear, periodLabel: v.periodLabel, dueDate: v.dueDate, amount: v.amount, amountNote: v.amountNote ?? null, scope: v.scope, yearLevel: v.yearLevel ?? null, targets: targets.length, created, skippedDuplicates: skipped },
      "schedule",
    );
    return { targets: targets.length, created, skippedDuplicates: skipped };
  });
}

/* ------------------------------------------------------------------ edit rules (LLD 8.3 "Past or verified payment records must not be silently changed") */

export interface EditRules {
  status: InstallmentStatus;
  submissionCount: number;
  /** Which fields may still be changed. */
  canEditAmount: boolean;
  canEditDueDate: boolean;
  canEditPeriod: boolean;
  canDelete: boolean;
  reason: string | null;
}

/**
 * D-034:
 *  - Paid: nothing can be changed (the verified payment is final).
 *  - Pending Verification: only the due date (the amount a receipt was checked against must not move).
 *  - Has receipt history (needs correction / rejected): amount and due date, but not the year/period identity.
 *  - No receipts: everything; and it may be removed.
 */
export function editRules(status: InstallmentStatus, submissionCount: number): EditRules {
  if (status === "paid") return { status, submissionCount, canEditAmount: false, canEditDueDate: false, canEditPeriod: false, canDelete: false, reason: "This installment is Paid. A verified payment cannot be changed from the schedule." };
  if (status === "pending_verification")
    return { status, submissionCount, canEditAmount: false, canEditDueDate: true, canEditPeriod: false, canDelete: false, reason: "A receipt is awaiting review, so only the due date can change. Review the receipt first to change the amount." };
  if (submissionCount > 0)
    return { status, submissionCount, canEditAmount: true, canEditDueDate: true, canEditPeriod: false, canDelete: false, reason: "This installment has receipt history, so its academic year and period cannot be renamed." };
  return { status, submissionCount, canEditAmount: true, canEditDueDate: true, canEditPeriod: true, canDelete: true, reason: null };
}

async function loadForEdit(db: Tx | ReturnType<typeof getDb>, obligationId: string, lock: boolean, today: string) {
  const q = db.select().from(ob).where(eq(ob.obligationId, obligationId)).limit(1);
  const [o] = lock ? await q.for("update") : await q;
  if (!o) throw new UserFacingError("That installment was not found.", "not_found", 404);
  const subs = await db.select({ status: sub.status, submittedAt: sub.submittedAt }).from(sub).where(eq(sub.obligationId, o.obligationId));
  const rules = editRules(deriveInstallmentStatus(o.dueDate, today, subs), subs.length);
  return { o, rules };
}

/** Read-only: the installment, its owner and what may be edited. Caller must have passed requireRole("admin"). */
export async function getObligationForEdit(obligationId: string, today = manilaToday()) {
  if (!z.string().uuid().safeParse(obligationId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ obligationId: ob.obligationId, studentId: users.userId, studentName: users.fullName, studentCode: users.studentId, yearLevel: users.yearLevel })
    .from(ob)
    .innerJoin(users, eq(users.userId, ob.studentId))
    .where(eq(ob.obligationId, obligationId));
  if (!row) return null;
  const { o, rules } = await loadForEdit(db, obligationId, false, today);
  const history = await db
    .select({ eventId: adminAuditEvents.eventId, action: adminAuditEvents.action, details: adminAuditEvents.details, createdAt: adminAuditEvents.createdAt, adminName: users.fullName })
    .from(adminAuditEvents)
    .innerJoin(users, eq(users.userId, adminAuditEvents.adminId))
    .where(and(eq(adminAuditEvents.entityType, "obligation"), eq(adminAuditEvents.entityId, obligationId)))
    .orderBy(desc(adminAuditEvents.createdAt))
    .limit(20);
  return { ...row, academicYear: o.academicYear, periodLabel: o.periodLabel, amount: o.amountDue, dueDate: o.dueDate, rules, history };
}

/* ------------------------------------------------------------------ update (LLD 8.3: updatePaymentSchedule) */

export async function updateObligation(adminId: string, obligationId: string, raw: Record<string, unknown>, now = new Date()): Promise<{ changed: string[] }> {
  if (!z.string().uuid().safeParse(obligationId).success) throw new UserFacingError("That installment was not found.", "not_found", 404);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) throw firstIssue(parsed.error);
  const v = parsed.data;
  const today = manilaToday(now);

  try {
    return await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const { o, rules } = await loadForEdit(tx, obligationId, true, today); // row lock: rules are evaluated on the state we will write to
      const changes: Record<string, { from: string; to: string }> = {};
      if (v.academicYear !== o.academicYear) changes.academicYear = { from: o.academicYear, to: v.academicYear };
      if (v.periodLabel !== o.periodLabel) changes.periodLabel = { from: o.periodLabel, to: v.periodLabel };
      if (v.dueDate !== o.dueDate) changes.dueDate = { from: o.dueDate, to: v.dueDate };
      if (toCents(v.amount) !== toCents(o.amountDue)) changes.amount = { from: o.amountDue, to: v.amount };
      const changed = Object.keys(changes);
      if (changed.length === 0) throw new UserFacingError("There are no changes to save.", "no_change", 422);

      if (rules.status === "paid") throw new UserFacingError(rules.reason!, "locked", 409);
      if (changes.amount && !rules.canEditAmount) throw new UserFacingError(rules.reason!, "locked", 409);
      if (changes.dueDate && !rules.canEditDueDate) throw new UserFacingError(rules.reason!, "locked", 409);
      if ((changes.academicYear || changes.periodLabel) && !rules.canEditPeriod) throw new UserFacingError(rules.reason!, "locked", 409);

      await tx
        .update(ob)
        .set({ academicYear: v.academicYear, periodLabel: v.periodLabel, dueDate: v.dueDate, amountDue: v.amount, updatedAt: now })
        .where(eq(ob.obligationId, o.obligationId));
      await audit(tx, adminId, "obligation_updated", o.obligationId, { changes, amountNote: changes.amount ? (v.amountNote ?? null) : null, student: o.studentId });
      return { changed };
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    if (pgErrorInfo(e).code === "23505") throw new UserFacingError("That student already has an installment with this academic year and period.", "duplicate_obligation", 409);
    console.error("[pnpay] schedule update failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not save the change. Nothing was changed. Please try again.", "save_failed", 500);
  }
}

/** Removes a mistakenly created installment. Only when it has NO receipt history and no upload in progress. */
export async function deleteObligation(adminId: string, obligationId: string, now = new Date()): Promise<void> {
  if (!z.string().uuid().safeParse(obligationId).success) throw new UserFacingError("That installment was not found.", "not_found", 404);
  try {
    await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const { o, rules } = await loadForEdit(tx, obligationId, true, manilaToday(now));
      if (!rules.canDelete) throw new UserFacingError("An installment with receipt history cannot be removed.", "locked", 409);
      const [live] = await tx
        .select({ id: intents.intentId })
        .from(intents)
        .where(and(eq(intents.obligationId, o.obligationId), isNull(intents.consumedAt), gt(intents.expiresAt, now)))
        .limit(1);
      if (live) throw new UserFacingError("A student is uploading a receipt for this installment right now. Try again in a few minutes.", "upload_in_progress", 409);
      await tx.delete(ob).where(eq(ob.obligationId, o.obligationId));
      await audit(tx, adminId, "obligation_removed", o.obligationId, { student: o.studentId, academicYear: o.academicYear, periodLabel: o.periodLabel, dueDate: o.dueDate, amount: o.amountDue });
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] schedule removal failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not remove the installment. Nothing was changed.", "save_failed", 500);
  }
}

/* ------------------------------------------------------------------ review existing obligations (grouped by period) */

export interface ScheduleGroup {
  academicYear: string;
  periodLabel: string;
  dueFrom: string;
  dueTo: string;
  amountFromCents: number;
  amountToCents: number;
  students: number;
  paid: number;
}

/** One row per academic year + installment period, with how many students have it and how many are Paid. */
export async function listScheduleGroups(): Promise<ScheduleGroup[]> {
  const rows = await getDb()
    .select({
      academicYear: ob.academicYear,
      period: sql<string>`min(${ob.periodLabel})`,
      dueFrom: sql<string>`min(${ob.dueDate})::text`,
      dueTo: sql<string>`max(${ob.dueDate})::text`,
      amountFrom: sql<string>`min(${ob.amountDue})`,
      amountTo: sql<string>`max(${ob.amountDue})`,
      students: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_submissions v WHERE v.obligation_id = ${ob.obligationId} AND v.status = 'verified'))::int`,
    })
    .from(ob)
    .groupBy(ob.academicYear, sql`lower(${ob.periodLabel})`)
    .orderBy(desc(ob.academicYear), asc(sql`min(${ob.dueDate})`));
  return rows.map((r) => ({
    academicYear: r.academicYear,
    periodLabel: r.period,
    dueFrom: r.dueFrom,
    dueTo: r.dueTo,
    amountFromCents: toCents(r.amountFrom),
    amountToCents: toCents(r.amountTo),
    students: r.students,
    paid: r.paid,
  }));
}
