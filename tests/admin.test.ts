import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { getAdminDashboard, listRecords, parseRecordFilters, RECORDS_PAGE_SIZE, type RecordFilters } from "@/lib/admin/records";
import { deleteSubmission, getReceiptForAdmin, getSubmissionDetails, reviewSubmission } from "@/lib/admin/review";
import { createBatchPlan, createSchedule, deleteObligation, planInstallments, editRules, getObligationForEdit, listScheduleGroups, updateObligation } from "@/lib/admin/schedules";
import { resetEnvCacheForTests } from "@/lib/env";
import { UserFacingError } from "@/lib/errors";
import { addDays, manilaToday } from "@/lib/payments/dates";
import { getDashboard, getInstallments, getNotifications, getOwnedReceipt, getPaymentHistory, getUnreadCount } from "@/lib/payments/queries";
import { deriveInstallmentStatus, type InstallmentStatus, type SubmissionStatus } from "@/lib/payments/status";
import { cleanupUploads, createUploadIntent, submitReceipt } from "@/lib/payments/submit";
import { MemoryStorage, setReceiptStorageForTests } from "@/lib/storage";
import { createAdminUser, createObligation, fakePng, resetDb } from "./helpers/db";

const { paymentSubmissions: sub, paymentReviews: reviews, paymentObligations: ob, notifications, adminAuditEvents, orphanedUploads, users, receiptUploadIntents: intents } = schema;
const today = manilaToday();
const future = addDays(today, 20);
const past = addDays(today, -20);

let storage: MemoryStorage;
let admin: Awaited<ReturnType<typeof createAdminUser>>;
beforeAll(() => resetEnvCacheForTests());
beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  setReceiptStorageForTests(storage);
  process.env.RECEIPT_MAX_BYTES = String(10 * 1024 * 1024);
  resetEnvCacheForTests();
  admin = await createAdminUser();
});

let n = 0;
async function mkStudent(fullName: string, code: string, batch: "2026" | "2027" | "alumni" = "2026", extra: Partial<typeof users.$inferInsert> = {}) {
  n++;
  const [u] = await getDb()
    .insert(users)
    .values({ fullName, studentId: code, email: `st${n}-${randomBytes(3).toString("hex")}@example.com`, passwordHash: "x", emailVerifiedAt: new Date(), batch, ...extra })
    .returning();
  return u;
}
type Student = Awaited<ReturnType<typeof mkStudent>>;

/** The real student flow (authorize upload -> put bytes -> submit), exactly what the browser does. */
async function submitFor(student: Student, obligationId: string, over: Record<string, unknown> = {}, bytes: Buffer = fakePng()) {
  const intent = await createUploadIntent(student.userId, obligationId);
  await storage.put(intent.storageKey, bytes, "image/png");
  return submitReceipt(student.userId, student.fullName, { obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash", referenceNumber: "", ...over });
}

/** Direct insert (bypasses the student flow) for building precise scenarios. */
async function insertSub(studentId: string, obligationId: string, status: SubmissionStatus, over: Partial<typeof sub.$inferInsert> = {}) {
  const [s] = await getDb()
    .insert(sub)
    .values({
      studentId,
      obligationId,
      amountSubmitted: "500.00",
      paymentDate: today,
      paymentMethod: "gcash",
      receiptKey: `receipts/${studentId}/${randomUUID()}`,
      receiptMime: "image/png",
      receiptSize: 400,
      receiptSha256: randomBytes(32).toString("hex"),
      status,
      submittedAt: new Date(),
      ...over,
    })
    .returning();
  return s;
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, `expected error ${code}`).toBeInstanceOf(UserFacingError);
  expect((err as UserFacingError).code).toBe(code);
}
/** Drizzle wraps driver errors ("Failed query ..."); the database's own message is in `cause`. */
async function expectDbError(p: Promise<unknown>, re: RegExp) {
  const e = (await p.then(() => null, (x) => x)) as { message?: string; cause?: { message?: string } } | null;
  expect(e, "expected the database to refuse the statement").not.toBeNull();
  expect(`${e?.cause?.message ?? ""} ${e?.message ?? ""}`).toMatch(re);
}
const review = (submissionId: string, decision: string, remarks?: string) => reviewSubmission(admin.userId, { submissionId, decision, remarks });
const subRow = async (id: string) => (await getDb().select().from(sub).where(eq(sub.submissionId, id)))[0];
const reviewRows = (id: string) => getDb().select().from(reviews).where(eq(reviews.submissionId, id));
const filt = (over: Partial<RecordFilters> = {}): RecordFilters => ({ sort: "due_date", dir: "asc", page: 1, ...over });

/** Fresh student + one installment + one pending submission via the real flow. */
async function pendingCase(due = future, label = "Case month", name = "Maria Santos", code = `S-${randomBytes(3).toString("hex")}`) {
  const student = await mkStudent(name, code.toUpperCase());
  const o = await createObligation(student.userId, due, label);
  const { submissionId } = await submitFor(student, o.obligationId, { referenceNumber: `REF-${randomBytes(4).toString("hex")}` });
  return { student, o, submissionId };
}

/* ================================================================== dashboard */
describe("Admin dashboard (test 1)", () => {
  it("1. shows zeros on an empty database (nothing hardcoded)", async () => {
    const d = await getAdminDashboard();
    expect([d.totalSubmissions, d.pending, d.verified, d.needsCorrection, d.rejected, d.students, d.installments, d.overdueCount, d.upcomingCount]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.recent).toEqual([]);
    expect(d.pendingQueue).toEqual([]);
  });

  it("1. every number comes from real records and follows changes", async () => {
    const a = await mkStudent("Ana A", "A-1");
    const b = await mkStudent("Ben B", "B-1");
    const oA1 = await createObligation(a.userId, past, "P1"); // pending, past due
    const oA2 = await createObligation(a.userId, future, "P2"); // verified
    const oA3 = await createObligation(a.userId, past, "P3"); // needs correction, past due -> overdue-counted
    const oB1 = await createObligation(b.userId, addDays(today, 5), "Q1"); // no receipt, due in 5 days -> upcoming
    const oB2 = await createObligation(b.userId, past, "Q2"); // rejected, past due -> overdue
    const oB3 = await createObligation(b.userId, addDays(today, 90), "Q3"); // far future: neither
    void oB1;
    void oB3;
    const s1 = await insertSub(a.userId, oA1.obligationId, "pending_review");
    await insertSub(a.userId, oA2.obligationId, "verified");
    await insertSub(a.userId, oA3.obligationId, "needs_correction");
    await insertSub(b.userId, oB2.obligationId, "rejected");

    const d = await getAdminDashboard();
    expect(d.totalSubmissions).toBe(4);
    expect([d.pending, d.verified, d.needsCorrection, d.rejected]).toEqual([1, 1, 1, 1]);
    expect(d.students).toBe(2);
    expect(d.installments).toBe(6);
    // Overdue: A3 (requires resubmission, past due) and B2 (rejected, past due); A1 is pending (not counted).
    expect(d.overdueCount).toBe(2);
    expect(d.overdue.map((r) => r.periodLabel).sort()).toEqual(["P3", "Q2"]);
    // Upcoming (next 30 days, unpaid): B1 only (A2 is paid, Q3 is 90 days away).
    expect(d.upcomingCount).toBe(1);
    expect(d.upcoming[0].periodLabel).toBe("Q1");
    expect(d.pendingQueue.map((p) => p.submissionId)).toEqual([s1.submissionId]);
    expect(d.recent).toHaveLength(4);

    // The numbers follow the data: verify the pending one and they move.
    await review(s1.submissionId, "verified");
    const d2 = await getAdminDashboard();
    expect([d2.pending, d2.verified]).toEqual([0, 2]);
    expect(d2.totalSubmissions).toBe(4);
  });

  it("1. unread admin notifications come from the notifications table", async () => {
    const { submissionId } = await pendingCase();
    expect(await getUnreadCount(admin.userId)).toBe(1);
    const list = await getNotifications(admin.userId);
    expect(list[0].submissionId).toBe(submissionId);
    expect(list[0].title).toBe("New receipt to review");
  });
});

/* ================================================================== authorization */
describe("Authorization at the service layer (test 2)", () => {
  it("2. a student (or anyone not the active admin) cannot review, schedule, edit or remove", async () => {
    const { student, o, submissionId } = await pendingCase();
    await expectCode(reviewSubmission(student.userId, { submissionId, decision: "verified" }), "forbidden");
    await expectCode(createSchedule(student.userId, { academicYear: "2026-2027", periodLabel: "Test period", dueDate: future, amount: "500.00", scope: "all" }), "forbidden");
    await expectCode(updateObligation(student.userId, o.obligationId, { academicYear: "2026-2027", periodLabel: "New", dueDate: future, amount: "500.00" }), "forbidden");
    await expectCode(deleteObligation(student.userId, o.obligationId), "forbidden");
    await expectCode(reviewSubmission(randomUUID(), { submissionId, decision: "verified" }), "forbidden");
    expect((await subRow(submissionId)).status).toBe("pending_review");
    expect(await reviewRows(submissionId)).toHaveLength(0);
  });

  it("2. a deactivated administrator can no longer review", async () => {
    const { submissionId } = await pendingCase();
    await getDb().update(users).set({ isActive: false }).where(eq(users.userId, admin.userId));
    await expectCode(review(submissionId, "verified"), "forbidden");
    expect((await subRow(submissionId)).status).toBe("pending_review");
  });
});

/* ================================================================== search / filter / sort */
async function seedDirectory() {
  const maria = await mkStudent("Maria Santos", "2024-0001", "2026");
  const mario = await mkStudent("Mario Reyes", "2024-0002", "2027");
  const juan = await mkStudent("Juan Dela Cruz", "2023-0100", "2026");
  const lea = await mkStudent("Lea Garcia", "2022-0500", "alumni");
  const oMaria = await createObligation(maria.userId, "2026-10-15", "October 2026");
  const oMario = await createObligation(mario.userId, "2026-10-20", "October 2026");
  const oJuan = await createObligation(juan.userId, "2026-10-05", "October 2026");
  const oJuanN = await createObligation(juan.userId, "2026-11-05", "November 2026");
  const oLea = await createObligation(lea.userId, "2026-09-10", "September 2026");
  await insertSub(maria.userId, oMaria.obligationId, "pending_review", { paymentDate: "2026-10-10", submittedAt: new Date("2026-10-11T02:00:00Z") });
  await insertSub(mario.userId, oMario.obligationId, "verified", { paymentDate: "2026-10-18", submittedAt: new Date("2026-10-19T02:00:00Z") });
  await insertSub(juan.userId, oJuan.obligationId, "pending_review", { paymentDate: "2026-10-03", submittedAt: new Date("2026-10-04T02:00:00Z") });
  await insertSub(lea.userId, oLea.obligationId, "rejected", { paymentDate: "2026-09-08", submittedAt: new Date("2026-09-09T02:00:00Z") });
  return { maria, mario, juan, lea, oMaria, oMario, oJuan, oJuanN, oLea };
}
const names = async (f: Partial<RecordFilters>) => (await listRecords(filt(f))).rows.map((r) => `${r.studentName}|${r.periodLabel}`);

describe("Student record search, filters and sorting (tests 3-7)", () => {
  it("3. search by student name (partial, case-insensitive)", async () => {
    await seedDirectory();
    expect(await names({ q: "maria" })).toEqual(["Maria Santos|October 2026"]);
    expect((await names({ q: "mar" })).sort()).toEqual(["Maria Santos|October 2026", "Mario Reyes|October 2026"]);
    expect(await names({ q: "dela cruz" })).toHaveLength(2); // Juan has two installments
  });

  it("4. search by student ID", async () => {
    await seedDirectory();
    expect(await names({ q: "2024-0002" })).toEqual(["Mario Reyes|October 2026"]);
    expect(await names({ q: "2022-" })).toEqual(["Lea Garcia|September 2026"]);
  });

  it("5. combined filters: pending receipts from 2026-batch students for October (the LLD example)", async () => {
    await seedDirectory();
    const r = await names({ submission: "pending_review", batch: "2026", month: "2026-10" });
    expect(r.sort()).toEqual(["Juan Dela Cruz|October 2026", "Maria Santos|October 2026"]);
    // Adding another condition narrows further.
    expect(await names({ submission: "pending_review", batch: "2026", month: "2026-10", q: "juan" })).toEqual(["Juan Dela Cruz|October 2026"]);
    // Payment date range + status.
    expect(await names({ payFrom: "2026-10-01", payTo: "2026-10-12" })).toEqual(["Juan Dela Cruz|October 2026", "Maria Santos|October 2026"]);
    expect(await names({ payFrom: "2026-10-01", payTo: "2026-10-12", submission: "verified" })).toEqual([]);
    // Installment status + batch.
    const paid = await names({ installment: "paid" });
    expect(paid).toEqual(["Mario Reyes|October 2026"]);
    // "No receipt submitted" finds Juan's November installment.
    expect(await names({ submission: "none" })).toEqual(["Juan Dela Cruz|November 2026"]);
    expect(await names({ batch: "alumni", submission: "rejected" })).toEqual(["Lea Garcia|September 2026"]);
  });

  it("6. sorting by student name, submission date and due date (both directions)", async () => {
    await seedDirectory();
    const sorted = async (sort: RecordFilters["sort"], dir: "asc" | "desc") => (await listRecords(filt({ sort, dir }))).rows.map((r) => r.studentName.split(" ")[0] + ":" + r.periodLabel.split(" ")[0]);
    expect(await sorted("student_name", "asc")).toEqual(["Juan:October", "Juan:November", "Lea:September", "Maria:October", "Mario:October"]);
    expect((await sorted("student_name", "desc"))[0]).toBe("Mario:October");
    expect(await sorted("due_date", "asc")).toEqual(["Lea:September", "Juan:October", "Maria:October", "Mario:October", "Juan:November"]);
    expect((await sorted("due_date", "desc"))[0]).toBe("Juan:November");
    // Submission date asc: Lea (Sep 9), Juan (Oct 4), Maria (Oct 11), Mario (Oct 19); the one with no submission goes last in both directions.
    expect(await sorted("submission_date", "asc")).toEqual(["Lea:September", "Juan:October", "Maria:October", "Mario:October", "Juan:November"]);
    expect(await sorted("submission_date", "desc")).toEqual(["Mario:October", "Maria:October", "Juan:October", "Lea:September", "Juan:November"]);
  });

  it("7. empty results are an empty list with total 0", async () => {
    await seedDirectory();
    const r = await listRecords(filt({ q: "nobody-by-this-name" }));
    expect(r).toMatchObject({ rows: [], total: 0, page: 1, pages: 1 });
    expect((await listRecords(filt({ month: "2030-01" }))).total).toBe(0);
  });

  it("filters and sorting never change statuses or receipts (read-only)", async () => {
    await seedDirectory();
    const snapshot = async () => ({
      subs: (await getDb().execute(sql`SELECT md5(string_agg(t::text, '|' ORDER BY submission_id)) AS h FROM payment_submissions t`)).rows[0],
      obs: (await getDb().execute(sql`SELECT md5(string_agg(t::text, '|' ORDER BY obligation_id)) AS h FROM payment_obligations t`)).rows[0],
      revs: (await getDb().execute(sql`SELECT count(*)::int AS n FROM payment_reviews`)).rows[0],
    });
    const before = await snapshot();
    for (const sort of ["due_date", "student_name", "submission_date"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        await listRecords(filt({ sort, dir, q: "a", submission: "pending_review", installment: "pending_verification", batch: "2026", month: "2026-10", payFrom: "2026-01-01", payTo: "2026-12-31" }));
      }
    }
    await getAdminDashboard();
    expect(await snapshot()).toEqual(before);
  });

  it("LIKE wildcards are literal and SQL injection text is only data", async () => {
    await seedDirectory();
    expect((await listRecords(filt({ q: "%" }))).total).toBe(0);
    expect((await listRecords(filt({ q: "_" }))).total).toBe(0);
    expect((await listRecords(filt({ q: "\\" }))).total).toBe(0);
    expect((await listRecords(filt({ q: "'; DROP TABLE users; --" }))).total).toBe(0);
    expect((await listRecords(filt({ q: "' OR '1'='1" }))).total).toBe(0);
    expect((await listRecords(filt())).total).toBe(5); // tables intact
    expect((await getDb().select({ c: sql<number>`count(*)::int` }).from(users))[0].c).toBeGreaterThan(0);
  });

  it("filter input is validated: bad values are dropped and reported", () => {
    const { filters, errors } = parseRecordFilters({ q: "x".repeat(101), batch: "1999", month: "2026-13", payFrom: "2026-02-30", submission: "paid", installment: "weird", sort: "password", dir: "sideways", page: "-1" });
    expect(filters).toEqual({ sort: "due_date", dir: "asc", page: 1 });
    expect(errors).toHaveLength(9);
    const ok = parseRecordFilters({ q: " ana ", batch: "2027", month: "2026-10", payFrom: "2026-10-01", payTo: "2026-10-31", submission: "none", installment: "overdue", sort: "student_name", dir: "desc", page: "3" });
    expect(ok.errors).toEqual([]);
    expect(ok.filters).toMatchObject({ q: "ana", batch: "2027", month: "2026-10", submission: "none", installment: "overdue", sort: "student_name", dir: "desc", page: 3 });
    expect(parseRecordFilters({ payFrom: "2026-10-31", payTo: "2026-10-01" }).errors).toHaveLength(1);
  });

  it("pagination: stable pages, total, and out-of-range pages are clamped", async () => {
    const s = await mkStudent("Many Installments", "M-1");
    for (let i = 0; i < RECORDS_PAGE_SIZE * 2 + 10; i++) await createObligation(s.userId, addDays("2030-01-01", i), `P${String(i).padStart(3, "0")}`);
    const p1 = await listRecords(filt({ page: 1 }));
    const p3 = await listRecords(filt({ page: 3 }));
    const far = await listRecords(filt({ page: 99 }));
    expect([p1.rows.length, p3.rows.length, p1.total, p1.pages]).toEqual([RECORDS_PAGE_SIZE, 10, RECORDS_PAGE_SIZE * 2 + 10, 3]);
    expect(far.page).toBe(3);
    const all = [...p1.rows, ...(await listRecords(filt({ page: 2 }))).rows, ...p3.rows].map((r) => r.obligationId);
    expect(new Set(all).size).toBe(all.length); // no row repeated or skipped across pages
  });

  it("the SQL status used for filtering agrees with deriveInstallmentStatus for every state", async () => {
    const s = await mkStudent("Status Student", "ST-1");
    const mk = async (label: string, due: string, subs: { status: SubmissionStatus; at: string }[]) => {
      const o = await createObligation(s.userId, due, label);
      for (const x of subs) {
        // pending/verified are unique per installment, so older rows in these scenarios are closed ones
        await insertSub(s.userId, o.obligationId, x.status, { submittedAt: new Date(x.at) });
      }
      return o;
    };
    await mk("none-future", future, []);
    await mk("none-past", past, []);
    await mk("pending-past", past, [{ status: "pending_review", at: "2026-01-02T00:00:00Z" }]);
    await mk("verified-past", past, [{ status: "verified", at: "2026-01-02T00:00:00Z" }]);
    await mk("correction-future", future, [{ status: "needs_correction", at: "2026-01-02T00:00:00Z" }]);
    await mk("correction-past", past, [{ status: "needs_correction", at: "2026-01-02T00:00:00Z" }]);
    await mk("rejected-past", past, [{ status: "rejected", at: "2026-01-02T00:00:00Z" }]);
    await mk("rejected-future", future, [{ status: "rejected", at: "2026-01-02T00:00:00Z" }]);
    await mk("correction-then-pending", past, [{ status: "needs_correction", at: "2026-01-01T00:00:00Z" }, { status: "pending_review", at: "2026-01-02T00:00:00Z" }]);
    await mk("verified-and-rejected", past, [{ status: "verified", at: "2026-01-01T00:00:00Z" }, { status: "rejected", at: "2026-01-02T00:00:00Z" }]);
    await mk("rejected-then-correction", future, [{ status: "rejected", at: "2026-01-01T00:00:00Z" }, { status: "needs_correction", at: "2026-01-02T00:00:00Z" }]);
    await mk("due-today", today, []);

    const ts = new Map((await getInstallments(s.userId)).map((i) => [i.obligationId, i.status]));
    const sqlRows = (await listRecords(filt({ sort: "student_name" }))).rows;
    expect(sqlRows).toHaveLength(12);
    for (const r of sqlRows) expect(r.installmentStatus, r.periodLabel).toBe(ts.get(r.obligationId));
    // And filtering by each status returns exactly the TypeScript-derived set.
    for (const st of ["not_yet_due", "pending_verification", "paid", "requires_resubmission", "overdue"] as InstallmentStatus[]) {
      const expected = [...ts.entries()].filter(([, v]) => v === st).map(([k]) => k).sort();
      const got = (await listRecords(filt({ installment: st }))).rows.map((r) => r.obligationId).sort();
      expect(got, st).toEqual(expected);
    }
    expect(deriveInstallmentStatus(today, today, [])).toBe("not_yet_due");
  });
});

/* ================================================================== schedule management */
const sched = (over: Record<string, unknown> = {}) => ({ academicYear: "2026-2027", periodLabel: "November 2026", dueDate: "2026-11-15", amount: "500.00", scope: "all", ...over });
const upd = (id: string, over: Record<string, unknown> = {}) => updateObligation(admin.userId, id, { academicYear: "2026-2027", periodLabel: "Period", dueDate: future, amount: "500.00", ...over });

describe("Payment schedule management (tests 8-10)", () => {
  it("8. creates an installment for all active students only (not inactive, not the admin)", async () => {
    const a = await mkStudent("Ana", "C-1", "2026");
    const b = await mkStudent("Ben", "C-2", "2027");
    await mkStudent("Inactive", "C-3", "2026", { isActive: false });
    const r = await createSchedule(admin.userId, sched());
    expect(r).toEqual({ targets: 2, created: 2, skippedDuplicates: 0 });
    const rows = await getDb().select().from(ob);
    expect(rows.map((x) => x.studentId).sort()).toEqual([a.userId, b.userId].sort());
    expect(rows.every((x) => x.amountDue === "500.00" && x.dueDate === "2026-11-15" && x.academicYear === "2026-2027" && x.periodLabel === "November 2026")).toBe(true);
    // Students see it immediately (no other step).
    expect((await getInstallments(a.userId)).map((i) => i.periodLabel)).toEqual(["November 2026"]);
    // Recorded.
    const ev = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "schedule_created"));
    expect(ev).toHaveLength(1);
    expect(ev[0].adminId).toBe(admin.userId);
    expect(ev[0].details).toMatchObject({ created: 2, targets: 2, amount: "500.00", scope: "all" });
  });

  it("8. can target one batch or one student (by student ID, any case)", async () => {
    const y1 = await mkStudent("Y1", "D-1", "2026");
    const y2 = await mkStudent("Y2", "D-2", "2027");
    expect((await createSchedule(admin.userId, sched({ scope: "batch", batch: "2027" }))).created).toBe(1);
    expect((await getInstallments(y2.userId))).toHaveLength(1);
    expect((await getInstallments(y1.userId))).toHaveLength(0);
    expect((await createSchedule(admin.userId, sched({ periodLabel: "December 2026", scope: "student", studentCode: "d-1" }))).created).toBe(1);
    expect((await getInstallments(y1.userId)).map((i) => i.periodLabel)).toEqual(["December 2026"]);
    await expectCode(createSchedule(admin.userId, sched({ scope: "student", studentCode: "NOPE-1" })), "student_not_found");
    await expectCode(createSchedule(admin.userId, sched({ scope: "batch", batch: "alumni" })), "no_targets");
  });

  it("8. plans: 24 monthly installments per batch, each batch with its own start", async () => {
    const a = await mkStudent("Ana", "P-1", "2026");
    const b = await mkStudent("Ben", "P-2", "2027");
    const r = await createBatchPlan(admin.userId, { batch: "2026", firstDueDate: "2026-01-31", lastDueDate: "2027-12-31", amount: "500.00" });
    expect(r).toMatchObject({ targets: 1, created: 24, skippedDuplicates: 0, months: 24, lastDueDate: "2027-12-31" });
    expect(await getInstallments(a.userId)).toHaveLength(24);
    expect(await getInstallments(b.userId)).toHaveLength(0);
    // The 2027 batch starts later.
    await createBatchPlan(admin.userId, { batch: "2027", firstDueDate: "2027-01-15", lastDueDate: "2028-12-15", amount: "500.00" });
    expect(await getInstallments(b.userId)).toHaveLength(24);
    // Running again skips what exists; a late registrant gets the plan.
    await expectCode(createBatchPlan(admin.userId, { batch: "2026", firstDueDate: "2026-01-31", lastDueDate: "2027-12-31", amount: "500.00" }), "duplicate_obligation");
    const late = await mkStudent("Late", "P-3", "2026");
    const again = await createBatchPlan(admin.userId, { batch: "2026", firstDueDate: "2026-01-31", lastDueDate: "2027-12-31", amount: "500.00" });
    expect(again).toMatchObject({ targets: 2, created: 24, skippedDuplicates: 24 });
    expect(await getInstallments(late.userId)).toHaveLength(24);
    
    // Custom end: 12 months only; too long and backwards ranges are rejected.
    const c = await mkStudent("Cy", "P-4", "alumni");
    expect((await createBatchPlan(admin.userId, { batch: "alumni", firstDueDate: "2026-06-10", lastDueDate: "2027-05-10", amount: "500.00" })).created).toBe(12);
    expect(await getInstallments(c.userId)).toHaveLength(12);
    await expectCode(createBatchPlan(admin.userId, { batch: "alumni", firstDueDate: "2026-06-10", lastDueDate: "2028-06-10", amount: "500.00" }), "invalid_input"); // 25 months
    await expectCode(createBatchPlan(admin.userId, { batch: "alumni", firstDueDate: "2026-06-10", lastDueDate: "2026-05-10", amount: "500.00" }), "invalid_input"); // backwards
    await expectCode(createBatchPlan(admin.userId, { batch: "2030", firstDueDate: "2026-01-15", lastDueDate: "2027-12-15", amount: "500.00" }), "invalid_input");
  });

  it("8. planInstallments: month-end clamping and school-year labels", () => {
    const p = planInstallments("2026-01-31");
    expect(p).toHaveLength(24);
    expect(p[0]).toEqual({ academicYear: "2025-2026", periodLabel: "January 2026", dueDate: "2026-01-31" });
    expect(p[1].dueDate).toBe("2026-02-28");
    expect(p[7]).toMatchObject({ periodLabel: "August 2026", academicYear: "2026-2027" });
    expect(p[23]).toEqual({ academicYear: "2027-2028", periodLabel: "December 2027", dueDate: "2027-12-31" });
    expect(new Set(p.map((x) => x.periodLabel)).size).toBe(24);
  });

  it("8. validates academic year, period, due date and amount; a non-standard amount needs a note", async () => {
    await mkStudent("V", "V-1");
    const bad = async (over: Record<string, unknown>) => expectCode(createSchedule(admin.userId, sched(over)), "invalid_input");
    await bad({ academicYear: "2026-2028" });
    await bad({ academicYear: "26-27" });
    await bad({ periodLabel: " " });
    await bad({ periodLabel: "x".repeat(51) });
    await bad({ dueDate: "2026-02-30" });
    await bad({ dueDate: "" });
    await bad({ amount: "abc" });
    await bad({ amount: "0" });
    await bad({ amount: "-5" });
    await bad({ amount: "10.123" });
    await bad({ scope: "everyone" });
    await bad({ scope: "batch" }); // missing batch
    await bad({ scope: "student" }); // missing student id
    await bad({ amount: "600.00" }); // non-standard without a note
    await bad({ amount: "600.00", amountNote: "ok" }); // too short
    expect(await getDb().select().from(ob)).toHaveLength(0);
    const r = await createSchedule(admin.userId, sched({ amount: "650", amountNote: "Approved lab fee increase" }));
    expect(r.created).toBe(1);
    const [row] = await getDb().select().from(ob);
    expect(row.amountDue).toBe("650.00");
    const [ev] = await getDb().select().from(adminAuditEvents);
    expect(ev.details).toMatchObject({ amount: "650.00", amountNote: "Approved lab fee increase" });
  });

  it("10. duplicate obligations are prevented: same student + year + period (case/space-insensitive)", async () => {
    const a = await mkStudent("Ana", "E-1");
    await createSchedule(admin.userId, sched());
    await expectCode(createSchedule(admin.userId, sched()), "duplicate_obligation");
    await expectCode(createSchedule(admin.userId, sched({ periodLabel: "  november   2026 " })), "duplicate_obligation");
    await expectCode(createSchedule(admin.userId, sched({ periodLabel: "NOVEMBER 2026", dueDate: "2026-11-20" })), "duplicate_obligation");
    expect(await getDb().select().from(ob)).toHaveLength(1);
    // A different academic year is a different obligation.
    expect((await createSchedule(admin.userId, sched({ academicYear: "2027-2028" }))).created).toBe(1);
    // A new student appears later: only the missing one is created, the existing one is skipped untouched.
    const b = await mkStudent("Ben", "E-2");
    const r = await createSchedule(admin.userId, sched({ dueDate: "2026-11-30" }));
    expect(r).toEqual({ targets: 2, created: 1, skippedDuplicates: 1 });
    const [aRow] = (await getInstallments(a.userId)).filter((i) => i.academicYear === "2026-2027");
    expect(aRow.dueDate).toBe("2026-11-15"); // existing obligation was not overwritten
    expect((await getInstallments(b.userId))[0].dueDate).toBe("2026-11-30");
  });

  it("10. the database itself rejects a case-variant duplicate", async () => {
    const a = await mkStudent("Ana", "E-9");
    await createObligation(a.userId, future, "March 2027");
    await expect(createObligation(a.userId, future, "march 2027")).rejects.toThrow();
  });

  it("9. editing a future installment works, updates the timestamp and records before/after", async () => {
    const a = await mkStudent("Ana", "F-1");
    const o = await createObligation(a.userId, future, "Period");
    const before = (await getDb().select().from(ob).where(eq(ob.obligationId, o.obligationId)))[0];
    await new Promise((r) => setTimeout(r, 15));
    const res = await upd(o.obligationId, { dueDate: addDays(future, 7), amount: "550", amountNote: "Approved revised fee", periodLabel: "Renamed period" });
    expect(res.changed.sort()).toEqual(["amount", "dueDate", "periodLabel"]);
    const after = (await getDb().select().from(ob).where(eq(ob.obligationId, o.obligationId)))[0];
    expect(after).toMatchObject({ dueDate: addDays(future, 7), amountDue: "550.00", periodLabel: "Renamed period" });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const [ev] = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "obligation_updated"));
    expect(ev.entityId).toBe(o.obligationId);
    expect(ev.adminId).toBe(admin.userId);
    expect(ev.details).toMatchObject({ changes: { dueDate: { from: future, to: addDays(future, 7) }, amount: { from: "500.00", to: "550.00" }, periodLabel: { from: "Period", to: "Renamed period" } }, amountNote: "Approved revised fee" });
    // The student sees the new schedule.
    expect((await getInstallments(a.userId))[0]).toMatchObject({ periodLabel: "Renamed period", amountCents: 55000 });
  });

  it("9. no-change and invalid edits are refused; a rename into an existing period is refused", async () => {
    const a = await mkStudent("Ana", "F-2");
    const o1 = await createObligation(a.userId, future, "Period");
    await createObligation(a.userId, addDays(future, 30), "Other");
    await expectCode(upd(o1.obligationId), "no_change");
    await expectCode(upd(o1.obligationId, { dueDate: "nope" }), "invalid_input");
    await expectCode(upd(o1.obligationId, { amount: "700" }), "invalid_input"); // note needed
    await expectCode(upd(o1.obligationId, { periodLabel: "other" }), "duplicate_obligation");
    await expectCode(upd(randomUUID()), "not_found");
    await expectCode(upd("not-a-uuid"), "not_found");
    expect((await getDb().select().from(ob).where(eq(ob.obligationId, o1.obligationId)))[0].periodLabel).toBe("Period");
  });

  it("9. a Paid installment cannot be changed at all; a verified payment is never silently altered", async () => {
    const { student, o, submissionId } = await pendingCase(past, "Paid month");
    await review(submissionId, "verified");
    const paidBefore = (await getDashboard(student.userId)).paidCents;
    expect(paidBefore).toBe(50000);
    await expectCode(upd(o.obligationId, { periodLabel: "Paid month", dueDate: addDays(past, 3) }), "locked");
    await expectCode(upd(o.obligationId, { periodLabel: "Paid month", dueDate: past, amount: "900", amountNote: "attempt to change" }), "locked");
    await expectCode(upd(o.obligationId, { periodLabel: "Renamed" }), "locked");
    await expectCode(deleteObligation(admin.userId, o.obligationId), "locked");
    expect((await getDb().select().from(ob).where(eq(ob.obligationId, o.obligationId)))[0]).toMatchObject({ amountDue: "500.00", dueDate: past, periodLabel: "Paid month" });
    // Creating or editing OTHER installments does not touch it either.
    await createSchedule(admin.userId, sched({ periodLabel: "Next month" }));
    expect((await getDashboard(student.userId)).paidCents).toBe(paidBefore);
    expect((await subRow(submissionId)).status).toBe("verified");
  });

  it("9. while a receipt is pending only the due date can change; with correction/rejection history the amount can, the period cannot", async () => {
    const { o, submissionId } = await pendingCase(future, "Pend");
    await expectCode(upd(o.obligationId, { periodLabel: "Pend", amount: "600", amountNote: "should be blocked" }), "locked");
    expect((await upd(o.obligationId, { periodLabel: "Pend", dueDate: addDays(future, 5) })).changed).toEqual(["dueDate"]);
    await review(submissionId, "needs_correction", "Please resubmit a clearer screenshot");
    expect((await upd(o.obligationId, { periodLabel: "Pend", dueDate: addDays(future, 5), amount: "600", amountNote: "Approved change" })).changed).toEqual(["amount"]);
    await expectCode(upd(o.obligationId, { periodLabel: "Renamed", dueDate: addDays(future, 5), amount: "600", amountNote: "x y z w" }), "locked");
    await expectCode(deleteObligation(admin.userId, o.obligationId), "locked"); // has receipt history
  });

  it("editRules covers each state", () => {
    expect(editRules("paid", 1)).toMatchObject({ canEditAmount: false, canEditDueDate: false, canEditPeriod: false, canDelete: false });
    expect(editRules("pending_verification", 1)).toMatchObject({ canEditAmount: false, canEditDueDate: true, canEditPeriod: false, canDelete: false });
    expect(editRules("requires_resubmission", 1)).toMatchObject({ canEditAmount: true, canEditDueDate: true, canEditPeriod: false, canDelete: false });
    expect(editRules("overdue", 0)).toMatchObject({ canEditAmount: true, canEditDueDate: true, canEditPeriod: true, canDelete: true });
  });

  it("an installment with no receipts can be removed (recorded); not while an upload is in progress", async () => {
    const a = await mkStudent("Ana", "G-1");
    const o = await createObligation(a.userId, future, "Mistake");
    const intent = await createUploadIntent(a.userId, o.obligationId);
    await expectCode(deleteObligation(admin.userId, o.obligationId), "upload_in_progress");
    await getDb().update(intents).set({ consumedAt: new Date() }).where(eq(intents.intentId, intent.intentId));
    await deleteObligation(admin.userId, o.obligationId);
    expect(await getDb().select().from(ob)).toHaveLength(0);
    const [ev] = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "obligation_removed"));
    expect(ev.details).toMatchObject({ periodLabel: "Mistake", student: a.userId });
  });

  it("existing obligations can be reviewed grouped by year and period; detail view returns rules and history", async () => {
    const a = await mkStudent("Ana", "H-1");
    await mkStudent("Ben", "H-2");
    await createSchedule(admin.userId, sched());
    await createSchedule(admin.userId, sched({ periodLabel: "December 2026", dueDate: "2026-12-15", amount: "550", amountNote: "Approved December fee" }));
    const groups = await listScheduleGroups();
    expect(groups.map((g) => [g.periodLabel, g.students, g.paid, g.amountFromCents])).toEqual([
      ["November 2026", 2, 0, 50000],
      ["December 2026", 2, 0, 55000],
    ]);
    const [ob1] = await getInstallments(a.userId);
    await upd(ob1.obligationId, { periodLabel: "November 2026", dueDate: "2026-11-16" });
    const detail = await getObligationForEdit(ob1.obligationId);
    expect(detail?.studentName).toBe("Ana");
    expect(detail?.history).toHaveLength(1);
    expect(await getObligationForEdit("bad-id")).toBeNull();
    expect(await getObligationForEdit(randomUUID())).toBeNull();
  });
});

/* ================================================================== review workflow */
describe("Receipt verification workflow (tests 11-22)", () => {
  it("11+12. verifying an eligible receipt succeeds, is recorded, and counts toward the paid total", async () => {
    const { student, o, submissionId } = await pendingCase(past, "Verify me");
    expect((await getDashboard(student.userId)).paidCents).toBe(0); // pending does not count
    const res = await review(submissionId, "verified", "Looks good");
    expect(res).toMatchObject({ decision: "verified", submissionStatus: "verified", installmentStatus: "paid" });
    const s = await subRow(submissionId);
    expect(s).toMatchObject({ status: "verified", remarks: "Looks good" });
    expect(s.reviewedAt).toBeInstanceOf(Date);
    const [r] = await reviewRows(submissionId);
    expect(r).toMatchObject({ adminId: admin.userId, decision: "verified", previousStatus: "pending_review", remarks: "Looks good", obligationId: o.obligationId });
    expect(r.reviewedAt.getTime()).toBe(s.reviewedAt!.getTime()); // same instant in both rows
    const d = await getDashboard(student.userId);
    expect([d.paidCents, d.remainingCents, d.progressPercent, d.overdueCount]).toEqual([50000, 0, 100, 0]);
    expect((await getInstallments(student.userId))[0].status).toBe("paid");
  });

  it("12. only verified payments count: pending, needs-correction and rejected stay at zero; two installments sum correctly", async () => {
    const student = await mkStudent("Ana", "I-1");
    const o1 = await createObligation(student.userId, future, "One");
    const o2 = await createObligation(student.userId, addDays(future, 30), "Two", "750.00");
    const o3 = await createObligation(student.userId, addDays(future, 60), "Three");
    const s1 = await submitFor(student, o1.obligationId);
    const s2 = await submitFor(student, o2.obligationId);
    const s3 = await submitFor(student, o3.obligationId);
    expect((await getDashboard(student.userId)).paidCents).toBe(0);
    await review(s1.submissionId, "needs_correction", "Blurry receipt, resubmit");
    await review(s3.submissionId, "rejected", "Not a payment receipt");
    expect((await getDashboard(student.userId)).paidCents).toBe(0);
    await review(s2.submissionId, "verified");
    const d = await getDashboard(student.userId);
    expect([d.paidCents, d.totalCents, d.remainingCents]).toEqual([75000, 175000, 100000]);
  });

  it("22. the student gets the right in-app notification (and only that student), with the email queued", async () => {
    const { student, submissionId } = await pendingCase(future, "Notify month");
    const other = await mkStudent("Other", "I-2");
    await review(submissionId, "verified");
    const mine = await getNotifications(student.userId);
    const ver = mine.find((x) => x.type === "submission_verified")!;
    expect(ver).toMatchObject({ title: "Payment verified", submissionId, isRead: false });
    expect(ver.message).toContain("Notify month");
    const [row] = await getDb().select().from(notifications).where(eq(notifications.notificationId, ver.notificationId));
    expect(row.emailPending).toBe(true); // queued for the Phase 4 delivery workflow, nothing sent now
    expect(await getNotifications(other.userId)).toHaveLength(0);
    expect(await getUnreadCount(student.userId)).toBe(2); // "received" + "verified"
  });

  it("22. correction and rejection notifications use the right type and text", async () => {
    const a = await pendingCase(future, "Corr month", "Ana", "J-1");
    const b = await pendingCase(future, "Rej month", "Ben", "J-2");
    await review(a.submissionId, "needs_correction", "The amount is not visible");
    await review(b.submissionId, "rejected", "This is not a payment to the school");
    const na = (await getNotifications(a.student.userId)).find((x) => x.type === "correction_requested")!;
    const nb = (await getNotifications(b.student.userId)).find((x) => x.type === "submission_rejected")!;
    expect(na).toMatchObject({ title: "Correction requested", submissionId: a.submissionId });
    expect(nb).toMatchObject({ title: "Receipt rejected", submissionId: b.submissionId });
    expect(na.message).toContain("Corr month");
    expect(nb.message).toContain("Rej month");
    expect((await getNotifications(a.student.userId)).some((x) => x.type === "submission_rejected")).toBe(false);
  });

  it("13. a correction request requires remarks (missing, blank, too short, too long) and saves nothing without them", async () => {
    const { submissionId } = await pendingCase();
    for (const remarks of [undefined, "", "   ", "abc", "x".repeat(1001)]) {
      await expectCode(review(submissionId, "needs_correction", remarks), "invalid_input");
    }
    const s = await subRow(submissionId);
    expect(s).toMatchObject({ status: "pending_review", remarks: null, reviewedAt: null });
    expect(await reviewRows(submissionId)).toHaveLength(0);
  });

  it("14. a correction request sets the statuses correctly, keeps the original receipt and history, and is not paid", async () => {
    const { student, o, submissionId } = await pendingCase(future, "Corr");
    const before = await subRow(submissionId);
    const res = await review(submissionId, "needs_correction", "Reference number is cut off");
    expect(res).toMatchObject({ submissionStatus: "needs_correction", installmentStatus: "requires_resubmission" });
    const s = await subRow(submissionId);
    expect(s).toMatchObject({ status: "needs_correction", remarks: "Reference number is cut off" });
    expect(s.receiptKey).toBe(before.receiptKey);
    expect(await storage.size(s.receiptKey)).not.toBeNull(); // original receipt file preserved
    expect(s.submittedAt.getTime()).toBe(before.submittedAt.getTime());
    const [r] = await reviewRows(submissionId);
    expect(r).toMatchObject({ decision: "needs_correction", remarks: "Reference number is cut off", adminId: admin.userId });
    const d = await getDashboard(student.userId);
    expect(d.paidCents).toBe(0);
    expect((await getInstallments(student.userId))[0]).toMatchObject({ obligationId: o.obligationId, status: "requires_resubmission" });
    expect((await getPaymentHistory(student.userId)).rows[0]).toMatchObject({ status: "needs_correction", remarks: "Reference number is cut off" });
  });

  it("15. a rejection requires a reason and saves nothing without it", async () => {
    const { submissionId } = await pendingCase();
    for (const remarks of [undefined, "", "  ", "no"]) await expectCode(review(submissionId, "rejected", remarks), "invalid_input");
    expect(await subRow(submissionId)).toMatchObject({ status: "pending_review", remarks: null });
    expect(await reviewRows(submissionId)).toHaveLength(0);
  });

  it("16. a rejected submission stays in history, keeps its receipt, is not paid, and the installment falls back by due date", async () => {
    const past1 = await pendingCase(past, "Rej past", "Ana", "K-1");
    const fut1 = await pendingCase(future, "Rej future", "Ben", "K-2");
    expect((await review(past1.submissionId, "rejected", "Receipt is for another person")).installmentStatus).toBe("overdue");
    expect((await review(fut1.submissionId, "rejected", "Edited screenshot")).installmentStatus).toBe("not_yet_due");
    const h = await getPaymentHistory(past1.student.userId);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ status: "rejected", remarks: "Receipt is for another person" });
    const s = await subRow(past1.submissionId);
    expect(await storage.size(s.receiptKey)).not.toBeNull();
    expect((await getDashboard(past1.student.userId)).paidCents).toBe(0);
    expect((await getDashboard(past1.student.userId)).overdueCount).toBe(1);
  });

  it("17. a replacement submission after a correction or rejection is linked and preserves the previous history", async () => {
    const { student, o, submissionId: first } = await pendingCase(future, "Replace me");
    await review(first, "needs_correction", "Please resubmit the full screenshot");
    const second = (await submitFor(student, o.obligationId)).submissionId;
    expect((await subRow(second)).previousSubmissionId).toBe(first);
    await review(second, "rejected", "Still not a valid receipt");
    const third = (await submitFor(student, o.obligationId)).submissionId;
    expect((await subRow(third)).previousSubmissionId).toBe(second);
    const d = await getSubmissionDetails(third);
    expect(d!.history.map((h) => [h.submissionId, h.status])).toEqual([
      [first, "needs_correction"],
      [second, "rejected"],
      [third, "pending_review"],
    ]);
    expect(d!.history[0].review).toMatchObject({ decision: "needs_correction", adminName: "Miss Jean" });
    expect(d!.history[1].review).toMatchObject({ decision: "rejected" });
    expect(d!.history[2].review).toBeNull();
    // The old reviews still exist, unchanged.
    expect(await reviewRows(first)).toHaveLength(1);
    expect(await reviewRows(second)).toHaveLength(1);
    await review(third, "verified");
    expect((await getDashboard(student.userId)).paidCents).toBe(50000); // counted once
    expect((await getPaymentHistory(student.userId)).total).toBe(3);
    // Once verified, a student cannot submit again.
    await expectCode(createUploadIntent(student.userId, o.obligationId), "not_eligible");
  });

  it("19. invalid state transitions are rejected and change nothing", async () => {
    const a = await pendingCase(future, "T1", "Ana", "L-1");
    await review(a.submissionId, "verified");
    for (const d of ["verified", "needs_correction", "rejected"]) await expectCode(review(a.submissionId, d, "second decision attempt"), "invalid_transition");
    expect((await subRow(a.submissionId)).status).toBe("verified");
    expect(await reviewRows(a.submissionId)).toHaveLength(1);

    const b = await pendingCase(future, "T2", "Ben", "L-2");
    await review(b.submissionId, "needs_correction", "needs a clearer photo");
    for (const d of ["verified", "rejected", "needs_correction"]) await expectCode(review(b.submissionId, d, "second decision attempt"), "invalid_transition");
    expect((await subRow(b.submissionId)).status).toBe("needs_correction");

    const c = await pendingCase(future, "T3", "Cy", "L-3");
    await review(c.submissionId, "rejected", "fake screenshot");
    await expectCode(review(c.submissionId, "verified"), "invalid_transition");
    expect((await subRow(c.submissionId)).status).toBe("rejected");
    expect((await getDashboard(c.student.userId)).paidCents).toBe(0);
    // Unknown / malformed input.
    await expectCode(review(randomUUID(), "verified"), "not_found");
    await expectCode(review("not-a-uuid", "verified"), "invalid_input");
    await expectCode(review(c.submissionId, "approve-everything"), "invalid_input");
    await expectCode(review(c.submissionId, "pending_review"), "invalid_input");
  });

  it("verification re-checks that the submission, installment and student agree, and that the amount is unchanged", async () => {
    const x = await pendingCase(future, "Rel1", "Ana", "M-1");
    const other = await mkStudent("Other", "M-9");
    await getDb().update(sub).set({ studentId: other.userId }).where(eq(sub.submissionId, x.submissionId)); // simulated corruption
    await expectCode(review(x.submissionId, "verified"), "inconsistent");
    expect((await subRow(x.submissionId)).status).toBe("pending_review");

    const y = await pendingCase(future, "Rel2", "Ben", "M-2");
    await getDb().update(ob).set({ amountDue: "600.00" }).where(eq(ob.obligationId, y.o.obligationId)); // simulated amount change after submission
    await expectCode(review(y.submissionId, "verified"), "amount_mismatch");
    expect((await subRow(y.submissionId)).status).toBe("pending_review");
    expect((await review(y.submissionId, "needs_correction", "Amount changed, please resubmit")).installmentStatus).toBe("requires_resubmission");
  });

  it("18. a duplicate transaction cannot be counted twice (student flow, DB index, and the review-time check)", async () => {
    // (a) through the student flow: the same reference or the same image is refused while the first is open/verified
    const a = await mkStudent("Ana", "N-1");
    const b = await mkStudent("Ben", "N-2");
    const oa = await createObligation(a.userId, future, "A");
    const ob2 = await createObligation(b.userId, future, "B");
    const ob3 = await createObligation(b.userId, addDays(future, 30), "B2");
    const bytes = fakePng();
    const sa = await submitFor(a, oa.obligationId, { referenceNumber: "GC-1234-5678" }, bytes);
    await review(sa.submissionId, "verified");
    await expectCode(submitFor(b, ob2.obligationId, { referenceNumber: "gc 1234 5678" }), "duplicate_reference");
    await expectCode(submitFor(b, ob3.obligationId, { referenceNumber: "" }, bytes), "duplicate_receipt");
    expect(await getDb().select().from(sub)).toHaveLength(1);

    // (b) the application-level review check, by temporarily removing the indexes that normally make the state impossible
    const refIdx = `CREATE UNIQUE INDEX "payment_submissions_open_reference_key" ON "payment_submissions" ("reference_normalized") WHERE "reference_normalized" IS NOT NULL AND "status" IN ('pending_review','verified')`;
    const hashIdx = `CREATE UNIQUE INDEX "payment_submissions_open_receipt_hash_key" ON "payment_submissions" ("receipt_sha256") WHERE "status" IN ('pending_review','verified')`;
    const oneIdx = `CREATE UNIQUE INDEX "payment_submissions_one_open_per_obligation" ON "payment_submissions" ("obligation_id") WHERE "status" IN ('pending_review','verified')`;
    const db = getDb();
    await db.execute(sql.raw(`DROP INDEX "payment_submissions_open_reference_key"; DROP INDEX "payment_submissions_open_receipt_hash_key"; DROP INDEX "payment_submissions_one_open_per_obligation"`));
    try {
      const s = await mkStudent("Cy", "N-3");
      const o1 = await createObligation(s.userId, future, "D1");
      const o2 = await createObligation(s.userId, future, "D2");
      const o3 = await createObligation(s.userId, future, "D3");
      const hash = randomBytes(32).toString("hex");
      await insertSub(s.userId, o1.obligationId, "verified", { referenceNumber: "ZZ-111111", referenceNormalized: "ZZ111111", receiptSha256: hash });
      const dupRef = await insertSub(s.userId, o2.obligationId, "pending_review", { referenceNumber: "ZZ-111111", referenceNormalized: "ZZ111111" });
      const dupImg = await insertSub(s.userId, o3.obligationId, "pending_review", { receiptSha256: hash });
      const dupSame = await insertSub(s.userId, o1.obligationId, "pending_review"); // second open submission for an already-paid installment
      await expectCode(review(dupRef.submissionId, "verified"), "duplicate_transaction");
      await expectCode(review(dupImg.submissionId, "verified"), "duplicate_transaction");
      await expectCode(review(dupSame.submissionId, "verified"), "already_paid");
      expect((await getDashboard(s.userId)).paidCents).toBe(50000); // counted once
      // The duplicates can still be corrected or rejected.
      await review(dupRef.submissionId, "rejected", "Same transaction as another payment");
    } finally {
      await resetDb();
      await db.execute(sql.raw(`${refIdx}; ${hashIdx}; ${oneIdx}`));
    }
    // (c) the indexes are back and effective
    const t = await mkStudent("Dee", "N-4");
    const o = await createObligation(t.userId, future, "E1");
    await insertSub(t.userId, o.obligationId, "pending_review", { referenceNormalized: "SAME12" });
    const o2 = await createObligation(t.userId, future, "E2");
    await expect(insertSub(t.userId, o2.obligationId, "pending_review", { referenceNormalized: "SAME12" })).rejects.toThrow();
  });

  it("20. concurrent review attempts count the payment once (one winner, one review row, one notification)", async () => {
    const { student, submissionId } = await pendingCase(future, "Race");
    const results = await Promise.allSettled([
      review(submissionId, "verified"),
      review(submissionId, "verified"),
      review(submissionId, "rejected", "Concurrent rejection attempt"),
      review(submissionId, "needs_correction", "Concurrent correction attempt"),
      review(submissionId, "verified"),
      review(submissionId, "verified"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(5);
    for (const f of failed) expect((f.reason as UserFacingError).code).toBe("invalid_transition");
    expect(await reviewRows(submissionId)).toHaveLength(1);
    const winner = (ok[0] as PromiseFulfilledResult<{ decision: string }>).value.decision;
    expect((await subRow(submissionId)).status).toBe(winner);
    const reviewNotes = (await getNotifications(student.userId)).filter((x) => x.type !== "submission_received");
    expect(reviewNotes).toHaveLength(1);
    const paid = (await getDashboard(student.userId)).paidCents;
    expect(paid).toBe(winner === "verified" ? 50000 : 0);
    expect(paid).toBeLessThanOrEqual(50000);
  });

  it("20. concurrent verification of many different receipts counts each exactly once", async () => {
    const cases = await Promise.all([1, 2, 3, 4].map((i) => pendingCase(future, `Multi${i}`, `Student ${i}`, `MC-${i}`)));
    await Promise.all(cases.flatMap((c) => [review(c.submissionId, "verified"), review(c.submissionId, "verified")].map((p) => p.catch(() => null))));
    for (const c of cases) {
      expect((await getDashboard(c.student.userId)).paidCents).toBe(50000);
      expect(await reviewRows(c.submissionId)).toHaveLength(1);
    }
  });

  it("20. reviewing while the student submits a replacement for the same installment stays consistent", async () => {
    const { student, o, submissionId } = await pendingCase(future, "Interleave");
    await review(submissionId, "needs_correction", "Please resubmit");
    const intent = await createUploadIntent(student.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    const [rep] = await Promise.all([
      submitReceipt(student.userId, student.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash", referenceNumber: "" }),
      review(submissionId, "verified").catch((e) => e), // the old one is no longer reviewable
    ]);
    expect((await subRow(rep.submissionId)).status).toBe("pending_review");
    expect((await subRow(submissionId)).status).toBe("needs_correction");
  });

  it("21. a database failure rolls back the whole review: no success, no review row, status unchanged, error recorded", async () => {
    const { student, submissionId } = await pendingCase(future, "Rollback");
    const db = getDb();
    await db.execute(sql`ALTER TABLE notifications RENAME TO notifications_broken`); // makes the notification step fail AFTER the status and review rows were written
    let err: unknown;
    try {
      await review(submissionId, "verified", "Should not persist");
    } catch (e) {
      err = e;
    } finally {
      await db.execute(sql`ALTER TABLE notifications_broken RENAME TO notifications`);
    }
    expect(err).toBeInstanceOf(UserFacingError);
    expect((err as UserFacingError).code).toBe("review_failed");
    expect((err as UserFacingError).message).toMatch(/Nothing was changed/);
    const s = await subRow(submissionId);
    expect(s).toMatchObject({ status: "pending_review", remarks: null, reviewedAt: null });
    expect(await reviewRows(submissionId)).toHaveLength(0);
    expect((await getDashboard(student.userId)).paidCents).toBe(0);
    expect((await getNotifications(student.userId)).some((x) => x.type === "submission_verified")).toBe(false);
    // The failure is recorded server-side, without receipt data.
    const [ev] = await db.select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "review_failed"));
    expect(ev.entityId).toBe(submissionId);
    expect(JSON.stringify(ev.details)).not.toContain("receipt");
    // And the same review succeeds once the database is healthy again.
    expect((await review(submissionId, "verified")).installmentStatus).toBe("paid");
  });

  it("21. an admin-side schedule failure also rolls back (audit write fails -> nothing created)", async () => {
    await mkStudent("Ana", "R-1");
    const db = getDb();
    await db.execute(sql`ALTER TABLE admin_audit_events RENAME TO admin_audit_events_broken`);
    try {
      await expect(createSchedule(admin.userId, sched())).rejects.toThrow();
    } finally {
      await db.execute(sql`ALTER TABLE admin_audit_events_broken RENAME TO admin_audit_events`);
    }
    expect(await db.select().from(ob)).toHaveLength(0);
  });
});

/* ================================================================== access control and history integrity */
describe("Access control and review-history integrity (tests 23, 8-audit)", () => {
  it("23. a student cannot read another student's receipt at the data layer; the admin can read any", async () => {
    const a = await pendingCase(future, "Mine", "Ana", "O-1");
    const b = await mkStudent("Ben", "O-2");
    expect(await getOwnedReceipt(b.userId, a.submissionId)).toBeNull();
    expect(await getOwnedReceipt(a.student.userId, a.submissionId)).not.toBeNull();
    expect(await getOwnedReceipt(admin.userId, a.submissionId)).toBeNull(); // the owner query never matches an admin id
    const r = await getReceiptForAdmin(a.submissionId);
    expect(r?.mime).toBe("image/png");
    expect(await storage.size(r!.key)).not.toBeNull();
    expect(await getReceiptForAdmin(randomUUID())).toBeNull();
  });

  it("review history is append-only: UPDATE and DELETE are refused by the database, and a decision cannot be rewritten", async () => {
    const { submissionId } = await pendingCase();
    await review(submissionId, "rejected", "Not a valid receipt");
    const db = getDb();
    await db.insert(adminAuditEvents).values({ adminId: admin.userId, action: "probe", entityType: "obligation" }); // a row must exist for a row-level trigger to fire
    await expectDbError(db.execute(sql`UPDATE payment_reviews SET decision = 'verified'`), /append-only/);
    await expectDbError(db.execute(sql`UPDATE payment_reviews SET remarks = 'edited'`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM payment_reviews`), /append-only/);
    await expectDbError(db.execute(sql`UPDATE admin_audit_events SET action = 'x'`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM admin_audit_events`), /append-only/);
    const [r] = await reviewRows(submissionId);
    expect(r).toMatchObject({ decision: "rejected", remarks: "Not a valid receipt" });
  });

  it("the database enforces review constraints and allows a reviewed submission to detach from its audit row", async () => {
    const { o, submissionId, student } = await pendingCase();
    const db = getDb();
    const base = { submissionId, obligationId: o.obligationId, adminId: admin.userId, previousStatus: "pending_review" as const };
    await expect(db.insert(reviews).values({ ...base, decision: "rejected", remarks: null })).rejects.toThrow();
    await expect(db.insert(reviews).values({ ...base, decision: "needs_correction", remarks: "   " })).rejects.toThrow();
    await db.insert(reviews).values({ ...base, decision: "verified" });
    await expect(db.insert(reviews).values({ ...base, decision: "verified" })).rejects.toThrow(); // one review per submission
    await expect(db.delete(sub).where(eq(sub.submissionId, submissionId))).resolves.toBeDefined(); // review history remains append-only and detached
    await expect(db.delete(users).where(eq(users.userId, admin.userId))).rejects.toThrow(); // reviewer cannot be erased
    await expect(db.delete(ob).where(eq(ob.obligationId, o.obligationId))).rejects.toThrow();
    void student;
  });

  it("an admin can delete a verified submission, retain audit history, and allow a replacement", async () => {
    const { student, o, submissionId } = await pendingCase();
    await review(submissionId, "verified");
    const original = (await subRow(submissionId))!;
    expect(await storage.size(original.receiptKey)).toBe(400);
    expect((await getDashboard(student.userId)).paidCents).toBe(50000);

    await deleteSubmission(admin.userId, submissionId);

    expect(await subRow(submissionId)).toBeUndefined();
    expect(await storage.size(original.receiptKey)).toBeNull();
    expect((await getDashboard(student.userId)).paidCents).toBe(0);
    const [history] = await getDb().select().from(reviews).where(eq(reviews.obligationId, o.obligationId));
    expect(history).toMatchObject({ submissionId: null, decision: "verified", previousStatus: "pending_review" });
    const [event] = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "submission_deleted"));
    expect(event).toMatchObject({ adminId: admin.userId, entityId: submissionId, details: { previousStatus: "verified", reviewHistoryPreserved: true } });

    const replacement = await submitFor(student, o.obligationId, { referenceNumber: `REF-${randomBytes(4).toString("hex")}` });
    expect(replacement.submissionId).not.toBe(submissionId);
  });

  it("queues verified receipt cleanup after a temporary storage failure", async () => {
    const { submissionId } = await pendingCase();
    await review(submissionId, "verified");
    const original = (await subRow(submissionId))!;
    storage.failNext.delete = true;

    await deleteSubmission(admin.userId, submissionId);

    expect(await subRow(submissionId)).toBeUndefined();
    expect(storage.objects.has(original.receiptKey)).toBe(true);
    const [orphan] = await getDb().select().from(orphanedUploads).where(eq(orphanedUploads.storageKey, original.receiptKey));
    expect(orphan).toMatchObject({ storageKey: original.receiptKey, reason: "submission_deleted", attempts: 0, deletedAt: null });

    const cleanup = await cleanupUploads();
    expect(cleanup.orphansDeleted).toBe(1);
    expect(storage.objects.has(original.receiptKey)).toBe(false);
    const [cleaned] = await getDb().select().from(orphanedUploads).where(eq(orphanedUploads.orphanId, orphan.orphanId));
    expect(cleaned.deletedAt).toBeInstanceOf(Date);
  });

  it("submission details give the review screen everything it needs (LLD 9.1)", async () => {
    const { student, o, submissionId } = await pendingCase(future, "Detail month", "Detail Student", "DT-1");
    const d = (await getSubmissionDetails(submissionId))!;
    expect(d).toMatchObject({
      submissionId,
      studentName: "Detail Student",
      studentCode: "DT-1",
      periodLabel: "Detail month",
      amountDueCents: 50000,
      amountSubmittedCents: 50000,
      paymentMethod: "gcash",
      status: "pending_review",
      installmentStatus: "pending_verification",
      canReview: true,
      obligationId: o.obligationId,
      studentId: student.userId,
    });
    expect(d.submittedAt).toBeInstanceOf(Date);
    expect(d.referenceNumber).toMatch(/^REF-/);
    await review(submissionId, "verified");
    expect((await getSubmissionDetails(submissionId))!.canReview).toBe(false);
    expect(await getSubmissionDetails(randomUUID())).toBeNull();
    expect(await getSubmissionDetails("nope")).toBeNull();
  });

  it("24. Phase 2 student functions are unchanged after reviews: tracker, history, dashboard and remarks", async () => {
    const student = await mkStudent("Ana", "P-1");
    const o1 = await createObligation(student.userId, past, "Aug");
    const o2 = await createObligation(student.userId, future, "Sep");
    const s1 = await submitFor(student, o1.obligationId, { referenceNumber: "AB-123456" });
    await review(s1.submissionId, "verified", "Thank you");
    const d = await getDashboard(student.userId);
    expect([d.totalCents, d.paidCents, d.remainingCents, d.progressPercent, d.overdueCount, d.installmentCount]).toEqual([100000, 50000, 50000, 50, 0, 2]);
    expect(d.upcoming.map((u) => u.periodLabel)).toEqual(["Sep"]);
    expect((await getInstallments(student.userId)).map((i) => i.status)).toEqual(["paid", "not_yet_due"]);
    expect((await getPaymentHistory(student.userId)).rows[0]).toMatchObject({ status: "verified", remarks: "Thank you", referenceNumber: "AB-123456" });
    // The student can still submit for the open installment.
    expect((await submitFor(student, o2.obligationId)).status).toBe("pending_review");
  });
});
