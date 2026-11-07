import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { UserFacingError, pgErrorInfo } from "@/lib/errors";
import { isRealDate, manilaToday } from "@/lib/payments/dates";
import { STANDARD_INSTALLMENT_AMOUNT, toCents } from "@/lib/payments/money";
import { deriveInstallmentStatus, type InstallmentStatus } from "@/lib/payments/status";
import { MAX_INSTALLMENTS_PER_STUDENT, PLAN_MONTHS } from "@/lib/batches";
import { getBatchOptions } from "@/lib/batch-window";
import { ensureDeletionSchema } from "@/lib/db-compat";
import { assertAdmin, deleteOrQueueReceipt } from "./review";

const { paymentObligations: ob, paymentSubmissions: sub, receiptUploadIntents: intents, users, adminAuditEvents, batchPlans } = schema;

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

export const SCOPES = ["all", "batch", "student"] as const;

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
    batch: z.string().trim().optional(),
    studentCode: z.string().trim().max(30).optional(),
  })
  .superRefine((v, ctx) => {
    needsNote(v.amount, v.amountNote, ctx);
    if (v.scope === "batch" && !v.batch) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["batch"], message: "Choose a batch." });
    if (v.scope === "student" && !v.studentCode) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["studentCode"], message: "Enter the student ID." });
  });

const updateSchema = z
  .object({ academicYear: academicYearSchema, periodLabel: periodLabelSchema, dueDate: dueDateSchema, amount: amountSchema, amountNote: noteSchema })
  .superRefine((v, ctx) => needsNote(v.amount, v.amountNote, ctx));

/** The batch must be one of the currently open batches (or Alumni). */
async function assertOpenBatch(batch: string) {
  if (!(await getBatchOptions()).includes(batch)) throw new UserFacingError("Choose a batch.", "invalid_input", 422);
}

const firstIssue = (e: z.ZodError) => new UserFacingError(e.issues[0]?.message ?? "Please check the form.", "invalid_input", 422);

async function audit(tx: Tx, adminId: string, action: string, entityId: string | null, details: Record<string, unknown>, entityType = "obligation") {
  await tx.insert(adminAuditEvents).values({ adminId, action, entityType, entityId, details });
}

/* ------------------------------------------------------------------ create (LLD 8.3: createPaymentSchedule + assignInstallmentsToStudents) */

export interface CreateResult {
  targets: number;
  created: number;
  skippedDuplicates: number;
  /** Installments not created because the student already holds the maximum (24). */
  skippedFull: number;
}

type NewObligation = { studentId: string; academicYear: string; periodLabel: string; amountDue: string; dueDate: string };

/**
 * The ONLY way installments are inserted. Enforces, per student, inside the caller's transaction:
 *  - no duplicate period (case-insensitive, same academic year), and
 *  - never more than MAX_INSTALLMENTS_PER_STUDENT (24) installments in total; when a student has only some room left,
 *    the earliest due dates are kept and the rest are skipped.
 * Callers should lock the student rows (SELECT ... FOR UPDATE) first so two admins cannot both fill the last slot.
 */
async function insertCapped(tx: Tx, rows: NewObligation[]): Promise<{ created: number; duplicates: number; full: number }> {
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const have = new Map<string, { count: number; keys: Set<string> }>();
  for (let i = 0; i < studentIds.length; i += 500) {
    const found = await tx
      .select({ studentId: ob.studentId, academicYear: ob.academicYear, periodLabel: ob.periodLabel })
      .from(ob)
      .where(inArray(ob.studentId, studentIds.slice(i, i + 500)));
    for (const f of found) {
      const e = have.get(f.studentId) ?? { count: 0, keys: new Set<string>() };
      e.count += 1;
      e.keys.add(`${f.academicYear}|${f.periodLabel.toLowerCase()}`);
      have.set(f.studentId, e);
    }
  }
  const byStudent = new Map<string, NewObligation[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);

  const toInsert: NewObligation[] = [];
  let duplicates = 0;
  let full = 0;
  for (const [studentId, list] of byStudent) {
    const e = have.get(studentId) ?? { count: 0, keys: new Set<string>() };
    const seen = new Set(e.keys);
    const fresh = list
      .filter((r) => {
        const k = `${r.academicYear}|${r.periodLabel.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    duplicates += list.length - fresh.length;
    const room = Math.max(0, MAX_INSTALLMENTS_PER_STUDENT - e.count);
    toInsert.push(...fresh.slice(0, room));
    full += Math.max(0, fresh.length - room);
  }

  let created = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const res = await tx.insert(ob).values(chunk).onConflictDoNothing().returning({ id: ob.obligationId });
    created += res.length;
    duplicates += chunk.length - res.length;
  }
  return { created, duplicates, full };
}

/**
 * Creates one installment period for the chosen students in ONE transaction. A student who already has that
 * period (case-insensitive, same academic year) is skipped, never duplicated or overwritten (D-032).
 */
export async function createSchedule(adminId: string, raw: Record<string, unknown>): Promise<CreateResult> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) throw firstIssue(parsed.error);
  const v = parsed.data;
  if (v.scope === "batch") await assertOpenBatch(v.batch!);

  return getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const base = and(eq(users.role, "student"), eq(users.isActive, true));
    let targets: { userId: string }[];
    if (v.scope === "student") {
      targets = await tx
        .select({ userId: users.userId })
        .from(users)
        .where(and(base, eq(users.studentId, v.studentCode!.toUpperCase())))
        .for("update");
      if (targets.length === 0) throw new UserFacingError("No active student has that student ID.", "student_not_found", 404);
    } else if (v.scope === "batch") {
      targets = await tx.select({ userId: users.userId }).from(users).where(and(base, eq(users.batch, v.batch!))).for("update");
    } else {
      targets = await tx.select({ userId: users.userId }).from(users).where(base).for("update");
    }
    if (targets.length === 0) throw new UserFacingError("No active students match that selection.", "no_targets", 422);

    const { created, duplicates, full } = await insertCapped(
      tx,
      targets.map((t) => ({ studentId: t.userId, academicYear: v.academicYear, periodLabel: v.periodLabel, amountDue: v.amount, dueDate: v.dueDate })),
    );
    if (created === 0) {
      const one = targets.length === 1;
      if (full > 0 && duplicates === 0)
        throw new UserFacingError(
          one ? `That student already has the maximum of ${MAX_INSTALLMENTS_PER_STUDENT} installments. Remove one first.` : `Every selected student already has the maximum of ${MAX_INSTALLMENTS_PER_STUDENT} installments.`,
          "installment_limit",
          409,
        );
      throw new UserFacingError(
        one ? "That student already has this installment period for the academic year." : "Every selected student already has this installment period for the academic year.",
        "duplicate_obligation",
        409,
      );
    }
    await audit(
      tx,
      adminId,
      "schedule_created",
      null,
      { academicYear: v.academicYear, periodLabel: v.periodLabel, dueDate: v.dueDate, amount: v.amount, amountNote: v.amountNote ?? null, scope: v.scope, batch: v.batch ?? null, targets: targets.length, created, skippedDuplicates: duplicates, skippedFull: full },
      "schedule",
    );
    return { targets: targets.length, created, skippedDuplicates: duplicates, skippedFull: full };
  });
}

/* ------------------------------------------------------------------ 24-month plan for one batch */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Number of monthly installments from the start month to the end month, both included. */
export function planMonths(firstDueDate: string, lastDueDate: string): number {
  return (Number(lastDueDate.slice(0, 4)) - Number(firstDueDate.slice(0, 4))) * 12 + (Number(lastDueDate.slice(5, 7)) - Number(firstDueDate.slice(5, 7))) + 1;
}

/** Due dates for a plan: the first due date, then the same day of each following month (clamped to the month's last day). */
export function planInstallments(firstDueDate: string, months = PLAN_MONTHS): { academicYear: string; periodLabel: string; dueDate: string }[] {
  const y0 = Number(firstDueDate.slice(0, 4));
  const m0 = Number(firstDueDate.slice(5, 7)) - 1;
  const day = Number(firstDueDate.slice(8, 10));
  const out: { academicYear: string; periodLabel: string; dueDate: string }[] = [];
  for (let i = 0; i < months; i++) {
    const idx = m0 + i;
    const y = y0 + Math.floor(idx / 12);
    const m = idx % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const dueDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    // School year runs August-July (e.g. November 2026 -> 2026-2027, March 2027 -> 2026-2027).
    const start = m >= 7 ? y : y - 1;
    out.push({ academicYear: `${start}-${start + 1}`, periodLabel: `${MONTH_NAMES[m]} ${y}`, dueDate });
  }
  return out;
}

const planSchema = z
  .object({ batch: z.string({ required_error: "Choose a batch." }).trim().min(1, "Choose a batch."), firstDueDate: dueDateSchema, lastDueDate: dueDateSchema, amount: amountSchema, amountNote: noteSchema })
  .superRefine((v, ctx) => {
    needsNote(v.amount, v.amountNote, ctx);
    const n = planMonths(v.firstDueDate, v.lastDueDate);
    if (n < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lastDueDate"], message: "The end date must be in the same month as the start date or later." });
    else if (n > PLAN_MONTHS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lastDueDate"], message: `A plan can cover at most ${PLAN_MONTHS} months (2 years). Choose an earlier end date.` });
  });

type PlanTemplate = { firstDueDate: string; lastDueDate: string; amount: string };

/** Inserts the plan's installments for the given students (duplicates skipped, 24-per-student cap enforced). */
async function insertPlanFor(tx: Tx, studentIds: string[], t: PlanTemplate): Promise<{ created: number; duplicates: number; full: number }> {
  const plan = planInstallments(t.firstDueDate, planMonths(t.firstDueDate, t.lastDueDate));
  const rows = studentIds.flatMap((studentId) => plan.map((p) => ({ studentId, academicYear: p.academicYear, periodLabel: p.periodLabel, amountDue: t.amount, dueDate: p.dueDate })));
  return insertCapped(tx, rows);
}

/**
 * Gives a newly registered student the saved plan of their batch (if the administrator has created one).
 * Runs inside the registration transaction, so a student is never left half-assigned.
 */
export async function assignBatchPlanToStudent(tx: Tx, studentId: string, batch: string | null | undefined): Promise<number> {
  if (!batch) return 0;
  const [t] = await tx.select().from(batchPlans).where(eq(batchPlans.batch, batch)).limit(1);
  if (!t) return 0;
  return (await insertPlanFor(tx, [studentId], { firstDueDate: t.firstDueDate, lastDueDate: t.lastDueDate, amount: t.amount })).created;
}

/** Saved plans, one per batch (read-only; caller must have passed requireRole("admin")). */
export async function listBatchPlans() {
  const rows = await getDb().select().from(batchPlans).orderBy(asc(batchPlans.batch));
  const counts = await getDb()
    .select({ batch: users.batch, n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.isActive, true)))
    .groupBy(users.batch);
  const byBatch = new Map(counts.map((c) => [c.batch, c.n]));
  return rows.map((r) => ({ ...r, months: planMonths(r.firstDueDate, r.lastDueDate), students: byBatch.get(r.batch) ?? 0 }));
}

/**
 * Saves the batch's monthly plan (up to 24 months = 2 years, from the chosen start month to the chosen end month) and gives it to
 * every active student already in that batch. The saved plan is also given automatically to every student who registers into the
 * batch later. Existing periods are skipped, and no student is ever given more than 24 installments in total.
 */
export async function createBatchPlan(adminId: string, raw: Record<string, unknown>): Promise<CreateResult & { months: number; lastDueDate: string }> {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw firstIssue(parsed.error);
  const v = parsed.data;
  await assertOpenBatch(v.batch);
  const plan = planInstallments(v.firstDueDate, planMonths(v.firstDueDate, v.lastDueDate));
  const lastDueDate = plan[plan.length - 1].dueDate;

  return getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const targets = await tx.select({ userId: users.userId }).from(users).where(and(eq(users.role, "student"), eq(users.isActive, true), eq(users.batch, v.batch)))
      .for("update");
    const { created, duplicates, full } = await insertPlanFor(tx, targets.map((t) => t.userId), { firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount });
    // Students who are already full are not an error: the plan is still saved for future registrations (skippedFull reports them).
    if (targets.length > 0 && created === 0 && full === 0) throw new UserFacingError("Every student in that batch already has this plan.", "duplicate_obligation", 409);
    await tx
      .insert(batchPlans)
      .values({ batch: v.batch, firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount, amountNote: v.amountNote ?? null, updatedBy: adminId })
      .onConflictDoUpdate({ target: batchPlans.batch, set: { firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount, amountNote: v.amountNote ?? null, updatedAt: new Date(), updatedBy: adminId } });
    await audit(
      tx,
      adminId,
      "batch_plan_created",
      null,
      { batch: v.batch, firstDueDate: v.firstDueDate, lastDueDate, requestedEnd: v.lastDueDate, months: plan.length, amount: v.amount, amountNote: v.amountNote ?? null, students: targets.length, created, skippedDuplicates: duplicates, skippedFull: full, savedForNewStudents: true },
      "schedule",
    );
    return { targets: targets.length, created, skippedDuplicates: duplicates, skippedFull: full, months: plan.length, lastDueDate };
  });
}

/* ------------------------------------------------------------------ edit / delete a saved batch plan */

const planKey = (r: { academicYear: string; periodLabel: string }) => `${r.academicYear}|${r.periodLabel.toLowerCase()}`;
function* chunksOf<T>(list: T[], size = 500) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

export interface PlanSyncResult {
  /** Installments whose due date or amount was changed to match the new plan. */
  updated: number;
  /** Installments removed because they are not part of the new plan (or the plan was deleted). */
  removed: number;
  /** New installments added for students already in the batch. */
  created: number;
  /** Installments of the old plan left alone: they have receipts / an upload in progress, or were individually edited. */
  kept: number;
  skippedFull: number;
}

/**
 * Brings the installments that students already hold in line with an edited (or deleted) batch plan.
 * Only installments that still match the OLD plan exactly (same period, due date and amount) and have no receipts and no
 * upload in progress are touched; anything a student has paid or submitted, or an admin edited by hand, is never changed.
 * `next === null` means the plan is being deleted: untouched installments of the old plan are removed and nothing is added.
 */
async function syncPlanInstallments(tx: Tx, batch: string, prev: PlanTemplate, next: PlanTemplate | null, now: Date): Promise<PlanSyncResult> {
  const out: PlanSyncResult = { updated: 0, removed: 0, created: 0, kept: 0, skippedFull: 0 };
  const targets = await tx
    .select({ userId: users.userId })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.isActive, true), eq(users.batch, batch)))
    .for("update");
  const studentIds = targets.map((t) => t.userId);
  if (studentIds.length === 0) return out;

  const oldPlan = new Map(planInstallments(prev.firstDueDate, planMonths(prev.firstDueDate, prev.lastDueDate)).map((p) => [planKey(p), p]));
  const newPlan = new Map<string, { dueDate: string }>(next ? planInstallments(next.firstDueDate, planMonths(next.firstDueDate, next.lastDueDate)).map((p) => [planKey(p), p] as const) : []);

  const rows: { obligationId: string; academicYear: string; periodLabel: string; dueDate: string; amountDue: string }[] = [];
  for (const part of chunksOf(studentIds)) {
    rows.push(...(await tx.select({ obligationId: ob.obligationId, academicYear: ob.academicYear, periodLabel: ob.periodLabel, dueDate: ob.dueDate, amountDue: ob.amountDue }).from(ob).where(inArray(ob.studentId, part))));
  }
  const fromOldPlan = rows.filter((r) => oldPlan.has(planKey(r)));
  const untouched = fromOldPlan.filter((r) => oldPlan.get(planKey(r))!.dueDate === r.dueDate && toCents(r.amountDue) === toCents(prev.amount));

  const blocked = new Set<string>();
  for (const part of chunksOf(untouched.map((r) => r.obligationId))) {
    for (const r of await tx.selectDistinct({ id: sub.obligationId }).from(sub).where(inArray(sub.obligationId, part))) blocked.add(r.id);
    for (const r of await tx.selectDistinct({ id: intents.obligationId }).from(intents).where(and(inArray(intents.obligationId, part), isNull(intents.consumedAt), gt(intents.expiresAt, now)))) blocked.add(r.id);
  }
  const editable = untouched.filter((r) => !blocked.has(r.obligationId));
  out.kept = fromOldPlan.length - editable.length;

  const toDelete = editable.filter((r) => !newPlan.has(planKey(r))).map((r) => r.obligationId);
  for (const part of chunksOf(toDelete)) await tx.delete(ob).where(inArray(ob.obligationId, part));
  out.removed = toDelete.length;

  if (next) {
    const byDue = new Map<string, string[]>(); // new due date -> obligations to move/re-price
    for (const r of editable) {
      const p = newPlan.get(planKey(r));
      if (!p) continue;
      if (p.dueDate !== r.dueDate || toCents(r.amountDue) !== toCents(next.amount)) byDue.set(p.dueDate, [...(byDue.get(p.dueDate) ?? []), r.obligationId]);
    }
    for (const [dueDate, ids] of byDue) {
      for (const part of chunksOf(ids)) await tx.update(ob).set({ dueDate, amountDue: next.amount, updatedAt: now }).where(inArray(ob.obligationId, part));
      out.updated += ids.length;
    }
    const added = await insertPlanFor(tx, studentIds, next); // months that are new to a student; existing periods are skipped
    out.created = added.created;
    out.skippedFull = added.full;
  }
  return out;
}

/** One saved plan with how many active students are in its batch (read-only; caller must have passed requireRole("admin")). */
export async function getBatchPlan(batch: string) {
  const db = getDb();
  const [row] = await db.select().from(batchPlans).where(eq(batchPlans.batch, batch)).limit(1);
  if (!row) return null;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.isActive, true), eq(users.batch, batch)));
  return { ...row, months: planMonths(row.firstDueDate, row.lastDueDate), students: n };
}

/**
 * Edits a saved batch plan (start, end, amount). The saved plan always changes for future registrations. With applyToStudents,
 * students already in the batch are brought in line too (see syncPlanInstallments for exactly what is and is not touched).
 */
export async function updateBatchPlan(adminId: string, raw: Record<string, unknown>, applyToStudents: boolean, now = new Date()): Promise<PlanSyncResult & { months: number }> {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw firstIssue(parsed.error);
  const v = parsed.data;
  const months = planMonths(v.firstDueDate, v.lastDueDate);
  try {
    return await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const [old] = await tx.select().from(batchPlans).where(eq(batchPlans.batch, v.batch)).limit(1).for("update");
      if (!old) throw new UserFacingError("That batch plan was not found. It may have been deleted.", "not_found", 404);
      const same = old.firstDueDate === v.firstDueDate && old.lastDueDate === v.lastDueDate && toCents(old.amount) === toCents(v.amount) && (old.amountNote ?? null) === (v.amountNote ?? null);
      if (same && !applyToStudents) throw new UserFacingError("There are no changes to save.", "no_change", 422);
      const sync = applyToStudents
        ? await syncPlanInstallments(tx, v.batch, { firstDueDate: old.firstDueDate, lastDueDate: old.lastDueDate, amount: old.amount }, { firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount }, now)
        : { updated: 0, removed: 0, created: 0, kept: 0, skippedFull: 0 };
      await tx
        .update(batchPlans)
        .set({ firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount, amountNote: v.amountNote ?? null, updatedAt: now, updatedBy: adminId })
        .where(eq(batchPlans.batch, v.batch));
      await audit(
        tx,
        adminId,
        "batch_plan_updated",
        null,
        { batch: v.batch, from: { firstDueDate: old.firstDueDate, lastDueDate: old.lastDueDate, amount: old.amount }, to: { firstDueDate: v.firstDueDate, lastDueDate: v.lastDueDate, amount: v.amount }, amountNote: v.amountNote ?? null, appliedToStudents: applyToStudents, ...sync },
        "schedule",
      );
      return { ...sync, months };
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] batch plan update failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not save the plan. Nothing was changed. Please try again.", "save_failed", 500);
  }
}

/**
 * Deletes a saved batch plan, so future registrations in that batch no longer receive it. With removeInstallments, the plan's
 * installments that students already hold are removed too, but only those with no receipts and no upload in progress that were
 * never edited individually. Without it, every installment already given to students stays exactly as it is.
 */
export async function deleteBatchPlan(adminId: string, batch: string, removeInstallments: boolean, now = new Date()): Promise<PlanSyncResult> {
  if (!batch.trim()) throw new UserFacingError("That batch plan was not found.", "not_found", 404);
  try {
    return await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const [old] = await tx.select().from(batchPlans).where(eq(batchPlans.batch, batch)).limit(1).for("update");
      if (!old) throw new UserFacingError("That batch plan was not found. It may already have been deleted.", "not_found", 404);
      const sync = removeInstallments
        ? await syncPlanInstallments(tx, batch, { firstDueDate: old.firstDueDate, lastDueDate: old.lastDueDate, amount: old.amount }, null, now)
        : { updated: 0, removed: 0, created: 0, kept: 0, skippedFull: 0 };
      await tx.delete(batchPlans).where(eq(batchPlans.batch, batch));
      await audit(
        tx,
        adminId,
        "batch_plan_deleted",
        null,
        { batch, firstDueDate: old.firstDueDate, lastDueDate: old.lastDueDate, amount: old.amount, removedInstallmentsFromStudents: removeInstallments, installmentsRemoved: sync.removed, installmentsKept: sync.kept },
        "schedule",
      );
      return sync;
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] batch plan removal failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not delete the plan. Nothing was changed. Please try again.", "save_failed", 500);
  }
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
 * Edit locks (D-034, kept): Paid is fully locked, Pending Verification only allows the due date, receipt history locks the period name.
 * Deleting is different: an administrator may remove ANY installment. If it has receipts (including a verified payment) they are
 * deleted with it and the removal is written to the audit history.
 */
export function editRules(status: InstallmentStatus, submissionCount: number): EditRules {
  const canDelete = true;
  if (status === "paid") return { status, submissionCount, canEditAmount: false, canEditDueDate: false, canEditPeriod: false, canDelete, reason: "This installment is Paid, so its details are locked. You can still remove it below; that also deletes the verified payment and its receipt." };
  if (status === "pending_verification")
    return { status, submissionCount, canEditAmount: false, canEditDueDate: true, canEditPeriod: false, canDelete, reason: "A receipt is awaiting review, so only the due date can change. Review the receipt first to change the amount." };
  if (submissionCount > 0)
    return { status, submissionCount, canEditAmount: true, canEditDueDate: true, canEditPeriod: false, canDelete, reason: "This installment has receipt history, so its academic year and period cannot be renamed." };
  return { status, submissionCount, canEditAmount: true, canEditDueDate: true, canEditPeriod: true, canDelete, reason: null };
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
    .select({ obligationId: ob.obligationId, studentId: users.userId, studentName: users.fullName, studentCode: users.studentId, batch: users.batch })
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

/**
 * Removes one installment, whatever its status. Any receipts on it (pending, rejected AND verified) are deleted with it; the review
 * rows stay as detached audit history. Receipt files are removed after the transaction commits (failures go to the cleanup queue).
 * Only blocked while a student is mid-upload for this installment.
 */
export async function deleteObligation(adminId: string, obligationId: string, now = new Date()): Promise<{ receiptsDeleted: number; verifiedDeleted: number }> {
  if (!z.string().uuid().safeParse(obligationId).success) throw new UserFacingError("That installment was not found.", "not_found", 404);
  await ensureDeletionSchema();
  let result: { keys: string[]; verified: number };
  try {
    result = await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const { o, rules } = await loadForEdit(tx, obligationId, true, manilaToday(now));
      const [live] = await tx
        .select({ id: intents.intentId })
        .from(intents)
        .where(and(eq(intents.obligationId, o.obligationId), isNull(intents.consumedAt), gt(intents.expiresAt, now)))
        .limit(1);
      if (live) throw new UserFacingError("A student is uploading a receipt for this installment right now. Try again in a few minutes.", "upload_in_progress", 409);
      const subs = await tx.select({ receiptKey: sub.receiptKey, status: sub.status }).from(sub).where(eq(sub.obligationId, o.obligationId)).for("update");
      if (subs.length > 0) await tx.delete(sub).where(eq(sub.obligationId, o.obligationId));
      await tx.delete(ob).where(eq(ob.obligationId, o.obligationId));
      const verified = subs.filter((s) => s.status === "verified").length;
      await audit(tx, adminId, "obligation_removed", o.obligationId, {
        student: o.studentId,
        academicYear: o.academicYear,
        periodLabel: o.periodLabel,
        dueDate: o.dueDate,
        amount: o.amountDue,
        previousStatus: rules.status,
        receiptsDeleted: subs.length,
        verifiedPaymentsDeleted: verified,
      });
      return { keys: subs.map((s) => s.receiptKey), verified };
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] schedule removal failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not remove the installment. Nothing was changed.", "save_failed", 500);
  }
  for (const key of result.keys) await deleteOrQueueReceipt(key);
  return { receiptsDeleted: result.keys.length, verifiedDeleted: result.verified };
}

/**
 * Brings a student who already has more than 24 installments back to 24: keeps the 24 earliest due dates and removes the later
 * extras. Extras that have receipts or an upload in progress are NOT touched (delete those one by one on purpose).
 */
export async function trimExtraInstallments(adminId: string, studentUserId: string): Promise<{ removed: number; keptWithReceipts: number }> {
  if (!z.string().uuid().safeParse(studentUserId).success) throw new UserFacingError("That student was not found.", "not_found", 404);
  const now = new Date();
  try {
    return await getDb().transaction(async (tx) => {
      await assertAdmin(tx, adminId);
      const rows = await tx
        .select({ obligationId: ob.obligationId, academicYear: ob.academicYear, periodLabel: ob.periodLabel, dueDate: ob.dueDate })
        .from(ob)
        .where(eq(ob.studentId, studentUserId))
        .orderBy(asc(ob.dueDate), asc(ob.obligationId))
        .for("update");
      const extras = rows.slice(MAX_INSTALLMENTS_PER_STUDENT);
      if (extras.length === 0) throw new UserFacingError(`This student has no more than ${MAX_INSTALLMENTS_PER_STUDENT} installments.`, "no_change", 422);
      const ids = extras.map((e) => e.obligationId);
      const withSubs = await tx.selectDistinct({ id: sub.obligationId }).from(sub).where(inArray(sub.obligationId, ids));
      const withLive = await tx.selectDistinct({ id: intents.obligationId }).from(intents).where(and(inArray(intents.obligationId, ids), isNull(intents.consumedAt), gt(intents.expiresAt, now)));
      const blocked = new Set([...withSubs.map((r) => r.id), ...withLive.map((r) => r.id)]);
      const removable = extras.filter((e) => !blocked.has(e.obligationId));
      if (removable.length > 0) {
        await tx.delete(ob).where(inArray(ob.obligationId, removable.map((r) => r.obligationId)));
        await audit(tx, adminId, "installments_trimmed", null, { student: studentUserId, limit: MAX_INSTALLMENTS_PER_STUDENT, removed: removable.map((r) => `${r.periodLabel} (${r.academicYear})`), keptWithReceipts: extras.length - removable.length }, "student");
      }
      return { removed: removable.length, keptWithReceipts: extras.length - removable.length };
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] trim installments failed:", pgErrorInfo(e).code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not remove the extra installments. Nothing was changed.", "save_failed", 500);
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
