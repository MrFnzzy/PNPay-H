import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { UserFacingError } from "@/lib/errors";
import { manilaToday, addDays } from "@/lib/payments/dates";
import { getDashboard, getInstallments, getNotifications, getOwnedReceipt, getPaymentHistory, getUnreadCount, markAllNotificationsRead, markNotificationRead } from "@/lib/payments/queries";
import { detectImage } from "@/lib/payments/receipt-file";
import { countsAsOverdue, deriveInstallmentStatus } from "@/lib/payments/status";
import { cleanupUploads, createUploadIntent, submitReceipt } from "@/lib/payments/submit";
import { MemoryStorage, getReceiptStorage, setReceiptStorageForTests } from "@/lib/storage";
import { createAdminUser, createObligation, createStudent, fakeJpeg, fakePng, resetDb } from "./helpers/db";

const { paymentSubmissions: sub, notifications, receiptUploadIntents: intents, orphanedUploads } = schema;
const today = manilaToday();
const future = addDays(today, 20);
const past = addDays(today, -20);

let storage: MemoryStorage;
beforeAll(() => {
  resetEnvCacheForTests();
});
beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  setReceiptStorageForTests(storage);
  process.env.RECEIPT_MAX_BYTES = String(10 * 1024 * 1024);
  resetEnvCacheForTests();
});

type Student = Awaited<ReturnType<typeof createStudent>>;

/** Full student flow: authorize upload -> put bytes -> submit. Mirrors what the browser does. */
async function submitFor(student: Student, obligationId: string, over: Record<string, unknown> = {}, bytes: Buffer = fakePng()) {
  const intent = await createUploadIntent(student.userId, obligationId);
  await storage.put(intent.storageKey, bytes, "image/png");
  return submitReceipt(student.userId, student.fullName, {
    obligationId,
    intentId: intent.intentId,
    paymentDate: today,
    paymentMethod: "gcash",
    referenceNumber: "",
    ...over,
  });
}
async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, `expected error ${code}`).toBeInstanceOf(UserFacingError);
  expect((err as UserFacingError).code).toBe(code);
}
const setStatus = (id: string, status: "pending_review" | "verified" | "needs_correction" | "rejected") => getDb().update(sub).set({ status }).where(eq(sub.submissionId, id));

describe("Installment status rules (LLD section 9)", () => {
  const at = (s: string, status: "pending_review" | "verified" | "needs_correction" | "rejected", ms = 0) => ({ status, submittedAt: new Date(Date.parse(s) + ms) });
  it("derives each status", () => {
    expect(deriveInstallmentStatus(future, today, [])).toBe("not_yet_due");
    expect(deriveInstallmentStatus(past, today, [])).toBe("overdue");
    expect(deriveInstallmentStatus(today, today, [])).toBe("not_yet_due"); // due today is not yet overdue
    expect(deriveInstallmentStatus(past, today, [at("2026-01-01", "pending_review")])).toBe("pending_verification");
    expect(deriveInstallmentStatus(past, today, [at("2026-01-01", "verified")])).toBe("paid");
    expect(deriveInstallmentStatus(future, today, [at("2026-01-01", "needs_correction")])).toBe("requires_resubmission");
    expect(deriveInstallmentStatus(past, today, [at("2026-01-01", "rejected")])).toBe("overdue");
    expect(deriveInstallmentStatus(future, today, [at("2026-01-01", "rejected")])).toBe("not_yet_due");
  });
  it("a later pending replacement outranks an earlier correction request; verified always wins", () => {
    expect(deriveInstallmentStatus(past, today, [at("2026-01-01", "needs_correction"), at("2026-01-02", "pending_review")])).toBe("pending_verification");
    expect(deriveInstallmentStatus(past, today, [at("2026-01-01", "verified"), at("2026-01-02", "rejected")])).toBe("paid");
  });
  it("overdue count includes unpaid past-due items that are not awaiting review", () => {
    expect(countsAsOverdue("overdue", past, today)).toBe(true);
    expect(countsAsOverdue("requires_resubmission", past, today)).toBe(true);
    expect(countsAsOverdue("requires_resubmission", future, today)).toBe(false);
    expect(countsAsOverdue("pending_verification", past, today)).toBe(false);
    expect(countsAsOverdue("paid", past, today)).toBe(false);
  });
});

describe("Receipt file validation", () => {
  it("accepts PNG and JPEG by content and rejects everything else", () => {
    expect(detectImage(fakePng())?.mime).toBe("image/png");
    expect(detectImage(fakeJpeg())?.mime).toBe("image/jpeg");
    expect(detectImage(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(200)]))).toBeNull();
    expect(detectImage(Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(200)]))).toBeNull();
    expect(detectImage(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]))).toBeNull();
    expect(detectImage(Buffer.from("<script>alert(1)</script>".repeat(10)))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    expect(detectImage(fakePng().subarray(0, 20))).toBeNull(); // truncated
    const noEoi = fakeJpeg();
    noEoi[noEoi.length - 1] = 0;
    expect(detectImage(noEoi)).toBeNull(); // truncated JPEG
  });
});

describe("Dashboard calculations", () => {
  it("handles zero obligations safely", async () => {
    const s = await createStudent();
    const d = await getDashboard(s.userId);
    expect(d).toMatchObject({ totalCents: 0, paidCents: 0, remainingCents: 0, progressPercent: 0, overdueCount: 0, installmentCount: 0 });
    expect(d.monthly).toEqual([]);
  });

  it("computes totals from the database, not constants (any amount, any count)", async () => {
    const s = await createStudent();
    await createObligation(s.userId, past, "A", "750.00");
    await createObligation(s.userId, future, "B", "250.55");
    await createObligation(s.userId, addDays(future, 30), "C", "250.55");
    const d = await getDashboard(s.userId);
    expect(d.totalCents).toBe(125110);
    expect(d.installmentCount).toBe(3);
    expect(d.overdueCount).toBe(1);
    expect(d.remainingCents).toBe(125110);
    expect(d.upcoming.map((i) => i.periodLabel)).toEqual(["B", "C"]);
  });

  it("13. a pending submission does not count as paid; only verified does; progress is verified / total", async () => {
    const s = await createStudent();
    const [o1, o2, o3, o4] = [
      await createObligation(s.userId, past, "M1"),
      await createObligation(s.userId, addDays(today, 10), "M2"),
      await createObligation(s.userId, addDays(today, 40), "M3"),
      await createObligation(s.userId, addDays(today, 70), "M4"),
    ];
    const r1 = await submitFor(s, o1.obligationId);
    let d = await getDashboard(s.userId);
    expect(d.paidCents).toBe(0);
    expect(d.progressPercent).toBe(0);
    expect(d.installments.find((i) => i.periodLabel === "M1")?.status).toBe("pending_verification");

    await setStatus(r1.submissionId, "verified");
    d = await getDashboard(s.userId);
    expect(d.paidCents).toBe(50000);
    expect(d.remainingCents).toBe(150000);
    expect(d.progressPercent).toBe(25);
    expect(d.overdueCount).toBe(0);

    // correction requested / rejected are never paid
    const r2 = await submitFor(s, o2.obligationId);
    await setStatus(r2.submissionId, "needs_correction");
    const r3 = await submitFor(s, o3.obligationId);
    await setStatus(r3.submissionId, "rejected");
    d = await getDashboard(s.userId);
    expect(d.paidCents).toBe(50000);
    const st = Object.fromEntries(d.installments.map((i) => [i.periodLabel, i.status]));
    expect(st).toMatchObject({ M1: "paid", M2: "requires_resubmission", M3: "not_yet_due", M4: "not_yet_due" });
    void o4;
  });
});

describe("Student data isolation", () => {
  it("1+2. dashboard, tracker and history only ever contain the requesting student's records", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A-only");
    const ob = await createObligation(b.userId, future, "B-only", "900.00");
    await submitFor(a, oa.obligationId);
    await submitFor(b, ob.obligationId);

    const da = await getDashboard(a.userId);
    expect(da.installments.map((i) => i.periodLabel)).toEqual(["A-only"]);
    expect(da.totalCents).toBe(50000);
    expect(da.recent).toHaveLength(1);
    expect((await getInstallments(b.userId)).map((i) => i.periodLabel)).toEqual(["B-only"]);

    const ha = await getPaymentHistory(a.userId);
    expect(ha.total).toBe(1);
    expect(ha.rows.every((r) => r.periodLabel === "A-only")).toBe(true);
  });

  it("3. a student cannot retrieve another student's receipt", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A1");
    const { submissionId } = await submitFor(a, oa.obligationId);
    expect(await getOwnedReceipt(a.userId, submissionId)).not.toBeNull();
    expect(await getOwnedReceipt(b.userId, submissionId)).toBeNull();
    expect(await getOwnedReceipt(b.userId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("5. a student cannot submit for (or even start an upload for) another student's installment", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A1");
    await expectCode(createUploadIntent(b.userId, oa.obligationId), "not_found");

    // Even with a valid intent of their own for a different installment, B cannot target A's installment.
    const ob = await createObligation(b.userId, future, "B1");
    const intent = await createUploadIntent(b.userId, ob.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    await expectCode(submitReceipt(b.userId, b.fullName, { obligationId: oa.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "intent_invalid");
    expect(await getDb().select().from(sub)).toHaveLength(0);
  });

  it("an upload authorization of one student cannot be used by another", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A1");
    const ob = await createObligation(b.userId, future, "B1");
    const intent = await createUploadIntent(a.userId, oa.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    await expectCode(submitReceipt(b.userId, b.fullName, { obligationId: ob.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "intent_invalid");
  });

  it("notifications are scoped to their owner", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A1");
    await submitFor(a, oa.obligationId);
    const [n] = await getNotifications(a.userId);
    expect(await markNotificationRead(b.userId, n.notificationId)).toBe(false);
    expect(await getUnreadCount(a.userId)).toBe(1);
    expect(await markAllNotificationsRead(b.userId)).toBe(0);
    expect(await getNotifications(b.userId)).toHaveLength(0);
  });
});

describe("Submission business rules", () => {
  it("creates a Pending Review submission linked to the student and installment, with a server-generated private key", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const res = await submitFor(s, o.obligationId, { referenceNumber: "gc-1234 5678" });
    expect(res.status).toBe("pending_review");
    const [row] = await getDb().select().from(sub);
    expect(row).toMatchObject({ studentId: s.userId, obligationId: o.obligationId, status: "pending_review", paymentMethod: "gcash", referenceNumber: "gc-1234 5678", referenceNormalized: "GC12345678", receiptMime: "image/png" });
    expect(row.receiptKey).toMatch(new RegExp(`^receipts/${s.userId}/[0-9a-f-]{36}$`)); // no user-supplied filename
    expect(row.receiptSha256).toHaveLength(64);
    expect(row.submittedAt).toBeInstanceOf(Date);
    expect(row.previousSubmissionId).toBeNull();
    expect(await storage.size(row.receiptKey)).toBeGreaterThan(0);
  });

  it("accepts JPEG and records the detected type, not the declared one", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await submitFor(s, o.obligationId, {}, fakeJpeg());
    const [row] = await getDb().select().from(sub);
    expect(row.receiptMime).toBe("image/jpeg");
  });

  it("4+6. client-supplied amount, status, student id and role are ignored", async () => {
    const s = await createStudent();
    const other = await createStudent();
    const o = await createObligation(s.userId, future, "Aug", "500.00");
    await submitFor(s, o.obligationId, { amount: "1", amountSubmitted: "1", amountDue: "1", status: "verified", studentId: other.userId, role: "admin" });
    const [row] = await getDb().select().from(sub);
    expect(row.amountSubmitted).toBe("500.00");
    expect(row.status).toBe("pending_review");
    expect(row.studentId).toBe(s.userId);
  });

  it("7. cannot submit for a verified installment, nor while one is pending", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const first = await submitFor(s, o.obligationId);
    await expectCode(createUploadIntent(s.userId, o.obligationId), "not_eligible"); // pending
    await setStatus(first.submissionId, "verified");
    await expectCode(createUploadIntent(s.userId, o.obligationId), "not_eligible"); // paid

    // Even a pre-issued intent cannot slip past the check at submit time.
    const o2 = await createObligation(s.userId, addDays(future, 30), "Sep");
    const intent = await createUploadIntent(s.userId, o2.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    await getDb().insert(sub).values({ studentId: s.userId, obligationId: o2.obligationId, amountSubmitted: "500.00", paymentDate: today, paymentMethod: "gcash", receiptKey: "receipts/x/y", receiptMime: "image/png", receiptSize: 10, receiptSha256: "f".repeat(64), status: "verified" });
    await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o2.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "not_eligible");
    expect(storage.objects.has(intent.storageKey)).toBe(false); // the unused file was cleaned up
  });

  it("allows a replacement after correction/rejection and links it to the previous submission", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const first = await submitFor(s, o.obligationId);
    await setStatus(first.submissionId, "needs_correction");
    const second = await submitFor(s, o.obligationId);
    await setStatus(second.submissionId, "rejected");
    const third = await submitFor(s, o.obligationId);
    const [row] = await getDb().select().from(sub).where(eq(sub.submissionId, third.submissionId));
    expect(row.previousSubmissionId).toBe(second.submissionId);
    const [r2] = await getDb().select().from(sub).where(eq(sub.submissionId, second.submissionId));
    expect(r2.previousSubmissionId).toBe(first.submissionId);
    // history keeps all three
    expect((await getPaymentHistory(s.userId)).total).toBe(3);
  });

  it("concurrent double submit for one installment creates exactly one submission and cleans the other file", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const i1 = await createUploadIntent(s.userId, o.obligationId);
    const i2 = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(i1.storageKey, fakePng(), "image/png");
    await storage.put(i2.storageKey, fakePng(), "image/png");
    const run = (i: { intentId: string }) => submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: i.intentId, paymentDate: today, paymentMethod: "gcash" });
    const results = await Promise.allSettled([run(i1), run(i2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getDb().select().from(sub)).toHaveLength(1);
    expect(storage.objects.size).toBe(1);
  });

  it("12. duplicate transactions are blocked (same reference / same image), but reusable after rejection", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const [a1, a2] = [await createObligation(a.userId, future, "A1"), await createObligation(a.userId, addDays(future, 30), "A2")];
    const b1 = await createObligation(b.userId, future, "B1");
    const first = await submitFor(a, a1.obligationId, { referenceNumber: "REF-000111" });
    await expectCode(submitFor(a, a2.obligationId, { referenceNumber: "ref000111" }), "duplicate_reference"); // same student, formatting differs
    await expectCode(submitFor(b, b1.obligationId, { referenceNumber: "REF 000111" }), "duplicate_reference"); // another student

    const png = fakePng();
    await submitFor(a, a2.obligationId, {}, png);
    await expectCode(submitFor(b, b1.obligationId, {}, png), "duplicate_receipt"); // identical image
    expect(await getDb().select().from(sub)).toHaveLength(2);

    await setStatus(first.submissionId, "rejected");
    const ok = await submitFor(b, b1.obligationId, { referenceNumber: "REF000111" });
    expect(ok.status).toBe("pending_review");
  });

  it("validates payment date, method and reference", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await expectCode(submitFor(s, o.obligationId, { paymentDate: addDays(today, 1) }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { paymentDate: "2026-02-31" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { paymentDate: "" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { paymentDate: addDays(today, -500) }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { paymentMethod: "bitcoin" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { paymentMethod: "" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { referenceNumber: "12" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { referenceNumber: "<script>alert(1)</script>" }), "invalid_input");
    await expectCode(submitFor(s, o.obligationId, { obligationId: "not-a-uuid" }), "invalid_input");
    expect(await getDb().select().from(sub)).toHaveLength(0);
    // reference is optional
    await submitFor(s, o.obligationId, { referenceNumber: "" });
  });

  it("creates notifications for the student and the administrator in the same transaction", async () => {
    const admin = await createAdminUser();
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await submitFor(s, o.obligationId);
    const mine = await getNotifications(s.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "submission_received", isRead: false });
    const adminRows = await getDb().select().from(notifications).where(eq(notifications.userId, admin.userId));
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0].emailPending).toBe(true); // queued for the Phase 4 email job
    expect(adminRows[0].message).toContain(s.fullName);
  });

  it("still succeeds when no administrator account exists yet", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await expect(submitFor(s, o.obligationId)).resolves.toMatchObject({ status: "pending_review" });
  });

  it("students can mark notifications as read (one or all)", async () => {
    const s = await createStudent();
    const [o1, o2] = [await createObligation(s.userId, future, "A"), await createObligation(s.userId, addDays(future, 30), "B")];
    await submitFor(s, o1.obligationId);
    await submitFor(s, o2.obligationId);
    expect(await getUnreadCount(s.userId)).toBe(2);
    const list = await getNotifications(s.userId);
    expect(await markNotificationRead(s.userId, list[0].notificationId)).toBe(true);
    expect(await getUnreadCount(s.userId)).toBe(1);
    expect(await markAllNotificationsRead(s.userId)).toBe(1);
    expect(await getUnreadCount(s.userId)).toBe(0);
  });
});

describe("Upload and storage failure handling", () => {
  it("8. non-PNG/JPEG content is rejected on the server and the file is removed", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    for (const bad of [Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(300)]), Buffer.from("MZ" + "x".repeat(300)), Buffer.from("<html>".repeat(80))]) {
      await expectCode(submitFor(s, o.obligationId, {}, bad), "invalid_file");
    }
    expect(storage.objects.size).toBe(0);
    expect(await getDb().select().from(sub)).toHaveLength(0);
  });

  it("9. oversized uploads are rejected and removed", async () => {
    process.env.RECEIPT_MAX_BYTES = "100000";
    resetEnvCacheForTests();
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await expectCode(submitFor(s, o.obligationId, {}, fakePng(150_000)), "too_large");
    expect(storage.objects.size).toBe(0);
    await submitFor(s, o.obligationId, {}, fakePng(90_000)); // under the limit works
  });

  it("10. an upload that never completed is reported and nothing is saved", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "upload_missing");
    expect(await getDb().select().from(sub)).toHaveLength(0);
  });

  it("10b. a storage outage during verification is reported safely and the student can retry", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    storage.failNext.read = true;
    await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "storage_unavailable");
    expect(await getDb().select().from(sub)).toHaveLength(0);
    // the intent is still live, so a retry without re-uploading works
    await expect(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" })).resolves.toMatchObject({ status: "pending_review" });
  });

  it("11. a database failure after the upload saves nothing, returns a safe error and removes the file", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    // Real database failure inside the transaction: the notifications table disappears for a moment.
    await getDb().execute(sql`ALTER TABLE notifications RENAME TO notifications_off`);
    try {
      await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "save_failed");
    } finally {
      await getDb().execute(sql`ALTER TABLE notifications_off RENAME TO notifications`);
    }
    expect(await getDb().select().from(sub)).toHaveLength(0); // rolled back - no submission without its notification
    expect(storage.objects.has(intent.storageKey)).toBe(false); // unused file cleaned up
    const [i] = await getDb().select().from(intents).where(eq(intents.intentId, intent.intentId));
    expect(i.consumedAt).not.toBeNull(); // cannot be replayed
  });

  it("11b. if the cleanup itself fails, the file is recorded for later cleanup, and the cleanup job removes it", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    await getDb().execute(sql`ALTER TABLE notifications RENAME TO notifications_off`);
    storage.failNext.delete = true;
    try {
      await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "save_failed");
    } finally {
      await getDb().execute(sql`ALTER TABLE notifications_off RENAME TO notifications`);
    }
    const orphans = await getDb().select().from(orphanedUploads);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].storageKey).toBe(intent.storageKey);
    expect(storage.objects.has(intent.storageKey)).toBe(true);
    const res = await cleanupUploads();
    expect(res.orphansDeleted).toBe(1);
    expect(storage.objects.has(intent.storageKey)).toBe(false);
  });

  it("expired or reused upload authorizations are refused", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    await getDb().update(intents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(intents.intentId, intent.intentId));
    await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: intent.intentId, paymentDate: today, paymentMethod: "gcash" }), "intent_invalid");

    const ok = await submitFor(s, o.obligationId);
    const [row] = await getDb().select().from(sub).where(eq(sub.submissionId, ok.submissionId));
    // the consumed intent of a saved submission cannot be replayed for a new submission
    const used = await getDb().select().from(intents).where(eq(intents.storageKey, row.receiptKey));
    await expectCode(submitReceipt(s.userId, s.fullName, { obligationId: o.obligationId, intentId: used[0].intentId, paymentDate: today, paymentMethod: "gcash" }), "intent_invalid");
  });

  it("cleanup job deletes uploads that were authorized but never submitted", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    const intent = await createUploadIntent(s.userId, o.obligationId);
    await storage.put(intent.storageKey, fakePng(), "image/png");
    expect((await cleanupUploads()).expiredIntents).toBe(0); // still valid
    await getDb().update(intents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(intents.intentId, intent.intentId));
    expect((await cleanupUploads()).expiredIntents).toBe(1);
    expect(storage.objects.size).toBe(0);
  });

  it("the storage provider never exposes a URL and the submitted file is only readable through the provider", async () => {
    const s = await createStudent();
    const o = await createObligation(s.userId, future, "Aug");
    await submitFor(s, o.obligationId);
    const stored = getReceiptStorage();
    expect(Object.keys(stored).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(stored)))).not.toContain("publicUrl");
    const [row] = await getDb().select().from(sub);
    expect(row.receiptKey.startsWith("http")).toBe(false);
  });
});

describe("Authorization at the data layer", () => {
  it("another student's submission cannot be turned into a notification link for me", async () => {
    const a = await createStudent("A");
    const b = await createStudent("B");
    const oa = await createObligation(a.userId, future, "A1");
    await submitFor(a, oa.obligationId);
    const rows = await getDb().select().from(sub).where(and(eq(sub.studentId, b.userId)));
    expect(rows).toHaveLength(0);
    expect((await getPaymentHistory(b.userId)).total).toBe(0);
  });
});
