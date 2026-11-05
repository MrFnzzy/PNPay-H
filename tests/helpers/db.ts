import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { memoryOutbox } from "@/lib/email";

export async function resetDb() {
  await getDb().execute(sql`TRUNCATE users, payment_obligations, payment_submissions, payment_reviews, admin_audit_events, notifications, receipt_upload_intents, orphaned_uploads, email_verification_tokens, sessions, email_deliveries, rate_limit_events, payment_reminders, job_runs RESTART IDENTITY CASCADE`);
  memoryOutbox().length = 0;
}

export const validRegistration = (over: Record<string, unknown> = {}) => ({
  fullName: "Juan Dela Cruz",
  studentId: "2024-0001",
  email: "juan@example.com",
  course: "BSIT",
  yearLevel: "1",
  password: "Str0ngPassw0rd",
  confirmPassword: "Str0ngPassw0rd",
  ...over,
});

/** Extracts the raw verification token from the last email in the memory outbox. */
export function lastTokenFromOutbox(): string {
  const mail = memoryOutbox().at(-1);
  const m = mail?.text.match(/token=([A-Za-z0-9_%-]+)/);
  if (!m) throw new Error("no verification email found");
  return decodeURIComponent(m[1]);
}

import { randomBytes } from "node:crypto";

/** Minimal valid-looking PNG (signature + IHDR + random body) - unique bytes per call. */
export function fakePng(size = 400): Buffer {
  const head = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR"),
    Buffer.alloc(13, 1),
    Buffer.alloc(4, 2),
  ]);
  return Buffer.concat([head, randomBytes(Math.max(0, size - head.length))]);
}

/** Minimal valid-looking JPEG (SOI + random body + EOI). */
export function fakeJpeg(size = 400): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(Math.max(0, size - 6)), Buffer.from([0xff, 0xd9])]);
}

let counter = 0;
/** Inserts a verified student directly (bypasses registration; auth is covered by auth.test.ts). */
export async function createStudent(name = "Student") {
  counter++;
  const { users } = schema;
  const [u] = await getDb()
    .insert(users)
    .values({
      fullName: `${name} ${counter}`,
      studentId: `T-${counter}-${randomBytes(2).toString("hex")}`.toUpperCase(),
      email: `s${counter}-${randomBytes(3).toString("hex")}@example.com`,
      passwordHash: "x",
      emailVerifiedAt: new Date(),
      yearLevel: 1,
    })
    .returning();
  return u;
}

export async function createAdminUser() {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ fullName: "Miss Jean", email: `admin-${randomBytes(3).toString("hex")}@example.com`, passwordHash: "x", emailVerifiedAt: new Date(), role: "admin" })
    .returning();
  return u;
}

export async function createObligation(studentId: string, dueDate: string, label: string, amount = "500.00", year = "2026-2027") {
  const [o] = await getDb().insert(schema.paymentObligations).values({ studentId, academicYear: year, periodLabel: label, amountDue: amount, dueDate }).returning();
  return o;
}
