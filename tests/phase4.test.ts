import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { reviewSubmission } from "@/lib/admin/review";
import { authorizeCron } from "@/lib/cron";
import { failNextEmailForTests, memoryOutbox } from "@/lib/email";
import { backoffMinutes, getEmailOverview, MAX_EMAIL_ATTEMPTS, processEmailQueue, retryAllFailedEmails, retryFailedEmail } from "@/lib/email/queue";
import { resetEnvCacheForTests } from "@/lib/env";
import { UserFacingError } from "@/lib/errors";
import { runJob } from "@/lib/jobs";
import { addDays, manilaToday } from "@/lib/payments/dates";
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead } from "@/lib/payments/queries";
import { runPaymentReminders } from "@/lib/payments/reminders";
import { createUploadIntent, submitReceipt } from "@/lib/payments/submit";
import { MemoryStorage, setReceiptStorageForTests } from "@/lib/storage";
import { createAdminUser, createObligation, createStudent, fakePng, resetDb } from "./helpers/db";

const { notifications: nt, emailDeliveries: deliveries, paymentSubmissions: sub, paymentReviews: reviews, paymentReminders: rem, jobRuns, users, adminAuditEvents } = schema;
const today = manilaToday();

let storage: MemoryStorage;
let admin: Awaited<ReturnType<typeof createAdminUser>>;
beforeAll(() => resetEnvCacheForTests());
beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  setReceiptStorageForTests(storage);
  delete process.env.OVERDUE_REMINDERS_ENABLED;
  delete process.env.REMINDER_DAYS_BEFORE;
  delete process.env.CRON_SECRET;
  resetEnvCacheForTests();
  admin = await createAdminUser();
});

type Student = Awaited<ReturnType<typeof createStudent>>;

async function submitFor(student: Student, obligationId: string, ref = "") {
  const intent = await createUploadIntent(student.userId, obligationId);
  await storage.put(intent.storageKey, fakePng(), "image/png");
  return submitReceipt(student.userId, student.fullName, { obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash", referenceNumber: ref });
}
const notesOf = (userId: string) => getDb().select().from(nt).where(eq(nt.userId, userId)).orderBy(nt.createdAt);
const counts = async () => {
  const [s] = await getDb().select({ n: sql<number>`count(*)::int` }).from(sub);
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(reviews);
  return { submissions: s.n, reviews: r.n };
};

/** student + installment + a pending submission, ready for the admin. */
async function pendingScenario(opts: { ref?: string } = {}) {
  const student = await createStudent("Maria");
  const o = await createObligation(student.userId, addDays(today, 20), "August");
  const s = await submitFor(student, o.obligationId, opts.ref ?? "");
  return { student, o, submissionId: s.submissionId };
}

describe("Email delivery worker (LLD 11.3)", () => {
  it("sends the admin 'new receipt' email and records the attempt; the student's own receipt-received notice is in-app only", async () => {
    const { student } = await pendingScenario({ ref: "GC1234567890" });
    const r = await processEmailQueue();
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    const mail = memoryOutbox();
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe(admin.email);
    expect(mail[0].subject).toContain("New receipt to review");
    expect(mail[0].text).toContain("Maria");
    expect(mail[0].text).toContain("http://localhost:3000/admin/submissions/");
    // Privacy: no reference number, no student ID, no student email, no receipt key in the email.
    const all = mail[0].text + mail[0].html;
    expect(all).not.toContain("GC1234567890");
    expect(all).not.toContain(student.studentId!);
    expect(all).not.toContain(student.email);
    expect(all).not.toContain("receipts/");
    const [stuNote] = await notesOf(student.userId);
    expect(stuNote).toMatchObject({ emailPending: false, emailStatus: "not_applicable" });
    const [adminNote] = await notesOf(admin.userId);
    expect(adminNote).toMatchObject({ emailPending: false, emailStatus: "sent", emailAttempts: 1, emailLastError: null });
    expect(adminNote.emailSentAt).toBeInstanceOf(Date);
    const log = await getDb().select().from(deliveries).where(eq(deliveries.notificationId, adminNote.notificationId));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "sent", attempts: 1, userId: admin.userId, toEmail: admin.email });
  });

  it("a second run sends nothing: a sent notification is never emailed again", async () => {
    await pendingScenario();
    await processEmailQueue();
    const again = await processEmailQueue();
    expect(again.claimed).toBe(0);
    expect(memoryOutbox()).toHaveLength(1);
  });

  it("verified, correction-requested and rejected decisions each email the STUDENT's verified address, without the remarks", async () => {
    const out: Record<string, string> = {};
    for (const [decision, remarks] of [["verified", ""], ["needs_correction", "SECRET-REMARK the photo is blurry"], ["rejected", "SECRET-REMARK wrong account"]] as const) {
      await resetDb();
      memoryOutbox().length = 0;
      admin = await createAdminUser();
      const { student, submissionId } = await pendingScenario();
      await processEmailQueue(); // admin "new receipt" email
      memoryOutbox().length = 0;
      await reviewSubmission(admin.userId, { submissionId, decision, remarks });
      const r = await processEmailQueue();
      expect(r.sent).toBe(1);
      expect(memoryOutbox()).toHaveLength(1);
      const m = memoryOutbox()[0];
      expect(m.to).toBe(student.email);
      expect(m.text + m.html).not.toContain("SECRET-REMARK"); // OPEN-14 / D-040: remarks stay in the app
      expect(m.text).toContain("http://localhost:3000/student/history");
      out[decision] = m.subject;
    }
    expect(out.verified).toContain("Payment verified");
    expect(out.needs_correction).toContain("Correction requested");
    expect(out.rejected).toContain("Receipt rejected");
  });

  it("a provider failure is recorded, the payment workflow is unaffected, and the email is retried with backoff and then sent once", async () => {
    const { student, submissionId } = await pendingScenario();
    await processEmailQueue(); // admin mail
    memoryOutbox().length = 0;
    await reviewSubmission(admin.userId, { submissionId, decision: "verified", remarks: "" });
    const before = await counts();

    failNextEmailForTests(true);
    const t0 = new Date();
    const r1 = await processEmailQueue({ now: t0 });
    expect(r1).toMatchObject({ claimed: 1, sent: 0, retryScheduled: 1, failed: 0 });
    const [n1] = await getDb().select().from(nt).where(and(eq(nt.userId, student.userId), eq(nt.type, "submission_verified")));
    expect(n1).toMatchObject({ emailPending: true, emailStatus: "queued", emailAttempts: 1 });
    expect(n1.emailLastError).toContain("simulated provider failure");
    expect(n1.emailNextAttemptAt!.getTime()).toBe(t0.getTime() + backoffMinutes(1) * 60_000);

    // Payment data is untouched and the student's in-app notification is still there.
    const [s] = await getDb().select().from(sub).where(eq(sub.submissionId, submissionId));
    expect(s.status).toBe("verified");
    expect((await getNotifications(student.userId)).some((x) => x.type === "submission_verified")).toBe(true);

    // Not due yet -> nothing happens (no early retry).
    expect((await processEmailQueue({ now: new Date(t0.getTime() + 30_000) })).claimed).toBe(0);
    expect(memoryOutbox()).toHaveLength(0);

    // Backoff elapsed -> retried and delivered exactly once.
    const r2 = await processEmailQueue({ now: new Date(t0.getTime() + 61_000) });
    expect(r2).toMatchObject({ claimed: 1, sent: 1 });
    expect(memoryOutbox()).toHaveLength(1);
    const log = await getDb().select().from(deliveries).where(eq(deliveries.notificationId, n1.notificationId)).orderBy(deliveries.createdAt);
    expect(log.map((l) => [l.status, l.attempts])).toEqual([["failed", 1], ["sent", 2]]);
    expect(await counts()).toEqual(before); // retries never create submissions or reviews
  });

  it("a permanent provider error fails at once, is visible to the administrator, and can be retried once the cause is fixed", async () => {
    const { student, submissionId } = await pendingScenario();
    await processEmailQueue();
    memoryOutbox().length = 0;
    await reviewSubmission(admin.userId, { submissionId, decision: "rejected", remarks: "wrong amount shown" });

    failNextEmailForTests("permanent");
    const r = await processEmailQueue();
    expect(r).toMatchObject({ claimed: 1, failed: 1, retryScheduled: 0 });
    const [n] = await getDb().select().from(nt).where(and(eq(nt.userId, student.userId), eq(nt.type, "submission_rejected")));
    expect(n).toMatchObject({ emailPending: false, emailStatus: "failed", emailAttempts: 1 });
    expect((await processEmailQueue()).claimed).toBe(0); // failed rows are not auto-picked up again

    const ov = await getEmailOverview();
    expect(ov.counts.failed).toBe(1);
    expect(ov.problems).toHaveLength(1);
    expect(ov.problems[0]).toMatchObject({ state: "failed", type: "submission_rejected", recipientName: student.fullName });
    expect(ov.problems[0].recipientEmailMasked).not.toBe(student.email); // masked in the admin view
    expect(JSON.stringify(ov)).not.toContain(student.email);

    await retryFailedEmail(admin.userId, n.notificationId);
    const [queued] = await getDb().select().from(nt).where(eq(nt.notificationId, n.notificationId));
    expect(queued).toMatchObject({ emailPending: true, emailStatus: "queued", emailAttempts: 0, emailRound: 1 });
    const r2 = await processEmailQueue();
    expect(r2.sent).toBe(1);
    expect(memoryOutbox()).toHaveLength(1);
    expect(memoryOutbox()[0].to).toBe(student.email);
    const audit = await getDb().select().from(adminAuditEvents).where(eq(adminAuditEvents.action, "email_retry"));
    expect(audit).toHaveLength(1);
  });

  it("only an administrator can retry; a sent email cannot be retried (no duplicate email)", async () => {
    const { student, submissionId } = await pendingScenario();
    await processEmailQueue();
    await reviewSubmission(admin.userId, { submissionId, decision: "verified", remarks: "" });
    await processEmailQueue();
    const [sent] = await getDb().select().from(nt).where(and(eq(nt.userId, student.userId), eq(nt.type, "submission_verified")));
    expect(sent.emailStatus).toBe("sent");
    await expect(retryFailedEmail(admin.userId, sent.notificationId)).rejects.toMatchObject({ code: "not_failed" });
    await expect(retryFailedEmail(student.userId, sent.notificationId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(retryAllFailedEmails(student.userId)).rejects.toBeInstanceOf(UserFacingError);
    expect(await retryAllFailedEmails(admin.userId)).toBe(0);
    expect((await processEmailQueue()).claimed).toBe(0);
    expect(memoryOutbox()).toHaveLength(2); // admin "new receipt" + student "verified", nothing more
  });

  it("retryable failures stop after the maximum number of attempts and then wait for the administrator", async () => {
    await pendingScenario();
    let now = new Date();
    for (let i = 1; i <= MAX_EMAIL_ATTEMPTS; i++) {
      failNextEmailForTests(true);
      const r = await processEmailQueue({ now });
      expect(r.claimed).toBe(1);
      expect(i < MAX_EMAIL_ATTEMPTS ? r.retryScheduled : r.failed).toBe(1);
      now = new Date(now.getTime() + 3 * 3600_000);
    }
    const [n] = await notesOf(admin.userId);
    expect(n).toMatchObject({ emailStatus: "failed", emailPending: false, emailAttempts: MAX_EMAIL_ATTEMPTS });
    expect((await processEmailQueue({ now })).claimed).toBe(0);
    const log = await getDb().select().from(deliveries).where(eq(deliveries.notificationId, n.notificationId));
    expect(log).toHaveLength(MAX_EMAIL_ATTEMPTS);
    expect(await retryAllFailedEmails(admin.userId)).toBe(1);
  });

  it("concurrent workers send each email exactly once (claim lease + SKIP LOCKED)", async () => {
    for (let i = 0; i < 4; i++) {
      const s = await createStudent("Concurrent");
      const o = await createObligation(s.userId, addDays(today, 10 + i), `P${i}`);
      await submitFor(s, o.obligationId);
    }
    const results = await Promise.all(Array.from({ length: 8 }, () => processEmailQueue({ limit: 10 })));
    expect(results.reduce((a, r) => a + r.sent, 0)).toBe(4);
    expect(memoryOutbox()).toHaveLength(4);
    expect(new Set(memoryOutbox().map((m) => m.idempotencyKey)).size).toBe(4);
    const [d] = await getDb().select({ n: sql<number>`count(*)::int` }).from(deliveries);
    expect(d.n).toBe(4);
  });

  it("a worker that crashed mid-send leaves a lease; the email is retried only after it expires, with the SAME idempotency key", async () => {
    await pendingScenario();
    const [n] = await notesOf(admin.userId);
    // Simulate a crashed worker: claimed (attempt counted, lease taken) but never completed.
    const t0 = new Date();
    await getDb().update(nt).set({ emailLockedUntil: new Date(t0.getTime() + 120_000), emailAttempts: 1 }).where(eq(nt.notificationId, n.notificationId));
    expect((await processEmailQueue({ now: new Date(t0.getTime() + 60_000) })).claimed).toBe(0);
    const r = await processEmailQueue({ now: new Date(t0.getTime() + 121_000) });
    expect(r.sent).toBe(1);
    expect(memoryOutbox()[0].idempotencyKey).toBe(`pnpay-notif-${n.notificationId}-r0`);
  });

  it("never emails an unverified or deactivated recipient", async () => {
    const { student, submissionId } = await pendingScenario();
    await processEmailQueue();
    memoryOutbox().length = 0;
    await reviewSubmission(admin.userId, { submissionId, decision: "verified", remarks: "" });
    await getDb().update(users).set({ isActive: false }).where(eq(users.userId, student.userId));
    const r = await processEmailQueue();
    expect(r).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(memoryOutbox()).toHaveLength(0);
    const [n] = await getDb().select().from(nt).where(and(eq(nt.userId, student.userId), eq(nt.type, "submission_verified")));
    expect(n).toMatchObject({ emailPending: false, emailStatus: "not_applicable" });
  });

  it("an unexpected provider/db hiccup in one email does not stop the others", async () => {
    for (let i = 0; i < 3; i++) {
      const s = await createStudent("Batch");
      const o = await createObligation(s.userId, addDays(today, 10 + i), `B${i}`);
      await submitFor(s, o.obligationId);
    }
    failNextEmailForTests(true);
    const r = await processEmailQueue({ limit: 10 });
    expect(r.claimed).toBe(3);
    expect(r.sent).toBe(2);
    expect(r.retryScheduled).toBe(1);
  });

  it("a corrected receipt resubmitted notifies the administrator with its own title", async () => {
    const { student, o, submissionId } = await pendingScenario();
    await reviewSubmission(admin.userId, { submissionId, decision: "needs_correction", remarks: "photo is cut off" });
    await submitFor(student, o.obligationId);
    const titles = (await notesOf(admin.userId)).map((x) => x.title);
    expect(titles).toEqual(["New receipt to review", "Corrected receipt resubmitted"]);
  });
});

describe("Database rules for the email queue", () => {
  it("email_pending requires email_status = 'queued' (check constraint)", async () => {
    const s = await createStudent();
    const bad = getDb().insert(nt).values({ userId: s.userId, type: "payment_reminder", title: "t", message: "m", emailPending: true, emailStatus: "sent" });
    await expect(bad).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("In-app notification authorization (LLD 11.2)", () => {
  it("each user can only list, count and mark their OWN notifications", async () => {
    const { student: a, submissionId } = await pendingScenario();
    const b = await createStudent("Other");
    const bo = await createObligation(b.userId, addDays(today, 15), "B");
    await submitFor(b, bo.obligationId);
    await reviewSubmission(admin.userId, { submissionId, decision: "verified", remarks: "" });

    const aList = await getNotifications(a.userId);
    const bList = await getNotifications(b.userId);
    const adminList = await getNotifications(admin.userId);
    expect(aList.map((x) => x.title).sort()).toEqual(["Payment verified", "Receipt received"]);
    expect(bList.map((x) => x.title)).toEqual(["Receipt received"]);
    expect(adminList).toHaveLength(2);
    // Cross-user mark-as-read is a no-op.
    expect(await markNotificationRead(b.userId, aList[0].notificationId)).toBe(false);
    expect(await markNotificationRead(a.userId, adminList[0].notificationId)).toBe(false);
    expect(await markNotificationRead(admin.userId, aList[0].notificationId)).toBe(false);
    expect(await getUnreadCount(a.userId)).toBe(2);
    expect(await markAllNotificationsRead(b.userId)).toBe(1);
    expect(await getUnreadCount(a.userId)).toBe(2);
    expect(await getUnreadCount(admin.userId)).toBe(2);
    // Owner can mark read; it is idempotent.
    expect(await markNotificationRead(a.userId, aList[0].notificationId)).toBe(true);
    expect(await markNotificationRead(a.userId, aList[0].notificationId)).toBe(false);
    expect(await getUnreadCount(a.userId)).toBe(1);
  });

  it("reminder notifications carry the related installment for navigation", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, addDays(today, 3), "September");
    await runPaymentReminders();
    const [n] = await getNotifications(s.userId);
    expect(n).toMatchObject({ type: "payment_reminder", obligationId: o.obligationId, isRead: false });
  });
});

describe("Payment reminders (LLD 11.4)", () => {
  const remindersFor = (obligationId: string) => getDb().select().from(rem).where(eq(rem.obligationId, obligationId));

  it("reminds for installments due within the default 5 days; not later ones, not past ones", async () => {
    const s = await createStudent();
    const d5 = await createObligation(s.userId, addDays(today, 5), "D5");
    const d0 = await createObligation(s.userId, today, "D0");
    const d6 = await createObligation(s.userId, addDays(today, 6), "D6");
    const past = await createObligation(s.userId, addDays(today, -1), "Past");
    const r = await runPaymentReminders();
    expect(r).toMatchObject({ dueSoonCreated: 2, overdueCreated: 0 });
    expect(await remindersFor(d5.obligationId)).toHaveLength(1);
    expect(await remindersFor(d0.obligationId)).toHaveLength(1);
    expect(await remindersFor(d6.obligationId)).toHaveLength(0);
    expect(await remindersFor(past.obligationId)).toHaveLength(0);
    const notes = await notesOf(s.userId);
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.type === "payment_reminder" && n.emailPending && n.emailStatus === "queued")).toBe(true);
    expect(notes[0].message).toMatch(/installment of ₱500\.00 is due on/);
  });

  it("excludes paid and awaiting-review installments, includes unpaid ones that need resubmission or were rejected", async () => {
    const s = await createStudent();
    const paid = await createObligation(s.userId, addDays(today, 2), "Paid");
    const pending = await createObligation(s.userId, addDays(today, 2), "Pending");
    const fix = await createObligation(s.userId, addDays(today, 2), "Fix");
    const rejected = await createObligation(s.userId, addDays(today, 2), "Rejected");
    const none = await createObligation(s.userId, addDays(today, 2), "None");
    const sp = await submitFor(s, paid.obligationId);
    await reviewSubmission(admin.userId, { submissionId: sp.submissionId, decision: "verified", remarks: "" });
    await submitFor(s, pending.obligationId);
    const sf = await submitFor(s, fix.obligationId);
    await reviewSubmission(admin.userId, { submissionId: sf.submissionId, decision: "needs_correction", remarks: "blurry image" });
    const sr = await submitFor(s, rejected.obligationId);
    await reviewSubmission(admin.userId, { submissionId: sr.submissionId, decision: "rejected", remarks: "not a receipt" });

    await runPaymentReminders();
    const reminded = async (o: { obligationId: string }) => (await remindersFor(o.obligationId)).length;
    expect(await reminded(paid)).toBe(0);
    expect(await reminded(pending)).toBe(0);
    expect(await reminded(fix)).toBe(1);
    expect(await reminded(rejected)).toBe(1);
    expect(await reminded(none)).toBe(1);
  });

  it("never creates the same reminder twice, even across repeated and concurrent runs", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, addDays(today, 4), "Once");
    await runPaymentReminders();
    const again = await runPaymentReminders();
    expect(again.dueSoonCreated).toBe(0);
    const results = await Promise.all(Array.from({ length: 6 }, () => runPaymentReminders()));
    expect(results.reduce((a, r) => a + r.dueSoonCreated, 0)).toBe(0);
    expect(await remindersFor(o.obligationId)).toHaveLength(1);
    expect(await notesOf(s.userId)).toHaveLength(1);
  });

  it("simultaneous first runs still produce exactly one reminder per installment", async () => {
    const s = await createStudent();
    const o1 = await createObligation(s.userId, addDays(today, 1), "C1");
    const o2 = await createObligation(s.userId, addDays(today, 2), "C2");
    const results = await Promise.all(Array.from({ length: 6 }, () => runPaymentReminders()));
    expect(results.reduce((a, r) => a + r.dueSoonCreated, 0)).toBe(2);
    expect(await remindersFor(o1.obligationId)).toHaveLength(1);
    expect(await remindersFor(o2.obligationId)).toHaveLength(1);
    const notes = await notesOf(s.userId);
    expect(notes).toHaveLength(2);
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(rem).where(sql`${rem.notificationId} is null`);
    expect(n).toBe(0); // every reminder row points at its notification
  });

  it("the database itself refuses a duplicate reminder row", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, addDays(today, 3), "Dup");
    await getDb().insert(rem).values({ obligationId: o.obligationId, kind: "due_soon", dueDate: o.dueDate });
    await expect(getDb().insert(rem).values({ obligationId: o.obligationId, kind: "due_soon", dueDate: o.dueDate })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("a rescheduled installment gets a new reminder; unverified or deactivated students and the admin get none", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, addDays(today, 3), "Moved");
    await runPaymentReminders();
    await getDb().update(schema.paymentObligations).set({ dueDate: addDays(today, 4) }).where(eq(schema.paymentObligations.obligationId, o.obligationId));
    expect((await runPaymentReminders()).dueSoonCreated).toBe(1);
    expect(await remindersFor(o.obligationId)).toHaveLength(2);

    const unverified = await createStudent();
    await getDb().update(users).set({ emailVerifiedAt: null }).where(eq(users.userId, unverified.userId));
    await createObligation(unverified.userId, addDays(today, 2), "U");
    const inactive = await createStudent();
    await getDb().update(users).set({ isActive: false }).where(eq(users.userId, inactive.userId));
    await createObligation(inactive.userId, addDays(today, 2), "I");
    expect((await runPaymentReminders()).dueSoonCreated).toBe(0);
    expect(await notesOf(unverified.userId)).toHaveLength(0);
    expect(await notesOf(inactive.userId)).toHaveLength(0);
    expect(await notesOf(admin.userId)).toHaveLength(0);
  });

  it("the reminder window follows REMINDER_DAYS_BEFORE", async () => {
    const s = await createStudent();
    await createObligation(s.userId, addDays(today, 8), "Far");
    expect((await runPaymentReminders()).dueSoonCreated).toBe(0);
    expect((await runPaymentReminders({ daysBefore: 10 })).dueSoonCreated).toBe(1);
    process.env.REMINDER_DAYS_BEFORE = "30";
    resetEnvCacheForTests();
    await createObligation(s.userId, addDays(today, 25), "Farther");
    expect((await runPaymentReminders()).dueSoonCreated).toBe(1);
  });

  it("overdue notices are OFF by default; once enabled each unpaid, non-pending overdue installment gets exactly one", async () => {
    const s = await createStudent();
    const late = await createObligation(s.userId, addDays(today, -3), "Late");
    const lateFix = await createObligation(s.userId, addDays(today, -4), "LateFix");
    const latePaid = await createObligation(s.userId, addDays(today, -5), "LatePaid");
    const latePending = await createObligation(s.userId, addDays(today, -6), "LatePending");
    const sf = await submitFor(s, lateFix.obligationId);
    await reviewSubmission(admin.userId, { submissionId: sf.submissionId, decision: "needs_correction", remarks: "unreadable image" });
    const sp = await submitFor(s, latePaid.obligationId);
    await reviewSubmission(admin.userId, { submissionId: sp.submissionId, decision: "verified", remarks: "" });
    await submitFor(s, latePending.obligationId);

    expect((await runPaymentReminders()).overdueCreated).toBe(0);
    expect(await getDb().select().from(rem)).toHaveLength(0);

    const r = await runPaymentReminders({ overdueEnabled: true });
    expect(r.overdueCreated).toBe(2);
    expect(await remindersFor(late.obligationId)).toHaveLength(1);
    expect(await remindersFor(lateFix.obligationId)).toHaveLength(1);
    expect(await remindersFor(latePaid.obligationId)).toHaveLength(0);
    expect(await remindersFor(latePending.obligationId)).toHaveLength(0);
    expect((await runPaymentReminders({ overdueEnabled: true })).overdueCreated).toBe(0);
    const over = (await notesOf(s.userId)).filter((n) => n.type === "installment_overdue");
    expect(over).toHaveLength(2);
    expect(over[0].message).toContain("has not been paid yet");
  });

  it("reminder emails go through the worker to the student only, once", async () => {
    const s = await createStudent("Reminded");
    await createObligation(s.userId, addDays(today, 3), "October");
    await runPaymentReminders();
    await runPaymentReminders();
    const r = await processEmailQueue();
    expect(r.sent).toBe(1);
    expect(memoryOutbox()).toHaveLength(1);
    expect(memoryOutbox()[0].to).toBe(s.email);
    expect(memoryOutbox()[0].subject).toContain("Payment due soon");
    expect(memoryOutbox()[0].text).toContain("/student/tracker");
    expect((await processEmailQueue()).claimed).toBe(0);
  });
});

describe("Scheduled jobs", () => {
  it("job runs are recorded with counts only, and a failing job reports ok=false without throwing", async () => {
    const ok = await runJob("reminders", async () => ({ dueSoonCreated: 3 }));
    expect(ok).toMatchObject({ ok: true, summary: { dueSoonCreated: 3 } });
    const bad = await runJob("email", async () => {
      throw new Error("db password=hunter2 leaked?");
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toContain("hunter2");
    const rows = await getDb().select().from(jobRuns).orderBy(jobRuns.startedAt);
    expect(rows.map((r) => [r.job, r.ok])).toEqual([["reminders", true], ["email", false]]);
    const ov = await getEmailOverview();
    expect(ov.lastRuns.map((r) => r.job).sort()).toEqual(["email", "reminders"]);
  });

  it("cron routes fail closed without CRON_SECRET, reject a wrong or missing secret, and accept the right one", async () => {
    const req = (auth?: string) => new Request("http://localhost/api/cron/daily", { headers: auth ? { authorization: auth } : {} });
    expect(authorizeCron(req())?.status).toBe(503);
    expect(authorizeCron(req("Bearer anything"))?.status).toBe(503);
    process.env.CRON_SECRET = "c".repeat(40);
    resetEnvCacheForTests();
    expect(authorizeCron(req())?.status).toBe(401);
    expect(authorizeCron(req("Bearer wrong"))?.status).toBe(401);
    expect(authorizeCron(req("c".repeat(40)))?.status).toBe(401); // scheme required
    expect(authorizeCron(req(`Bearer ${"c".repeat(40)}x`))?.status).toBe(401);
    expect(authorizeCron(req(`Bearer ${"c".repeat(40)}`))).toBeNull();
    delete process.env.CRON_SECRET;
    resetEnvCacheForTests();
  });
});

describe("Migration 0003 upgrades a database that already holds Phase 3 data", () => {
  it("applies on top of 0000-0002 data, backfills the email queue and keeps every row", async () => {
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const dbName = `pnpay_upgrade_${randomBytes(3).toString("hex")}`;
    await adminPool.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${dbName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      // A copy of the migrations folder that stops at Phase 3 (journal truncated).
      const tmp = mkdtempSync(path.join(tmpdir(), "pnpay-mig-"));
      cpSync("./drizzle", tmp, { recursive: true });
      const journalPath = path.join(tmp, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith("0003"));
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(drizzle(pool), { migrationsFolder: tmp });

      // Phase 3 data, including a queued email and an unqueued notification.
      const u = await pool.query(`INSERT INTO users (full_name, student_id, email, password_hash, email_verified_at, year_level) VALUES ('Old Student','OLD-1','old@example.com','x', now(), 1) RETURNING user_id`);
      const a = await pool.query(`INSERT INTO users (full_name, email, password_hash, email_verified_at, role) VALUES ('Jean','jean@example.com','x', now(), 'admin') RETURNING user_id`);
      const o = await pool.query(`INSERT INTO payment_obligations (student_id, academic_year, period_label, amount_due, due_date) VALUES ($1,'2026-2027','August',500,'2026-12-01') RETURNING obligation_id`, [u.rows[0].user_id]);
      await pool.query(`INSERT INTO notifications (user_id, type, title, message, obligation_id, email_pending) VALUES ($1,'submission_verified','Payment verified','m',$2,true), ($1,'submission_received','Receipt received','m',$2,false), ($3,'submission_received','New receipt','m',$2,true)`, [u.rows[0].user_id, o.rows[0].obligation_id, a.rows[0].user_id]);

      // Upgrade with the real, complete migrations folder.
      await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

      const rows = await pool.query(`SELECT title, email_pending, email_status, email_attempts, email_next_attempt_at IS NOT NULL AS due FROM notifications ORDER BY title`);
      expect(rows.rows).toHaveLength(3);
      for (const r of rows.rows) {
        if (r.email_pending) expect(r).toMatchObject({ email_status: "queued", email_attempts: 0, due: true });
        else expect(r).toMatchObject({ email_status: "not_applicable" });
      }
      for (const t of ["payment_reminders", "job_runs"]) expect((await pool.query(`SELECT to_regclass('public.${t}') AS t`)).rows[0].t).toBe(t);
      expect((await pool.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(2);
      expect((await pool.query(`SELECT count(*)::int AS n FROM payment_obligations`)).rows[0].n).toBe(1);
    } finally {
      await pool.end();
      await adminPool.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await adminPool.end();
    }
  });
});
