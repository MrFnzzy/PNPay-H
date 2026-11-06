import { ensureDeletionSchema } from "@/lib/db-compat";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyPassword } from "@/lib/auth/passwords";
import { UserFacingError } from "@/lib/errors";
import { getReceiptStorage } from "@/lib/storage";
import { assertAdmin } from "@/lib/admin/review";

const { users, paymentObligations: ob, paymentSubmissions: sub, receiptUploadIntents: intents, emailDeliveries, orphanedUploads, adminAuditEvents } = schema;

/**
 * Permanently deletes ONE student account and everything that belongs to the student: installments, receipts (database rows
 * and stored images), notifications, sessions, tokens and email records. The append-only review log is kept but detached
 * from the deleted installments/submissions (it holds no personal details beyond reviewer remarks).
 * Only student accounts can be deleted here, never the administrator.
 * `actorAdminId` is set when an administrator does it (an audit record is written); null when the student deletes themselves.
 */
async function removeStudent(studentUserId: string, actorAdminId: string | null) {
  await ensureDeletionSchema();
  const keys = await getDb().transaction(async (tx) => {
    if (actorAdminId) await assertAdmin(tx, actorAdminId);
    const [u] = await tx.select().from(users).where(eq(users.userId, studentUserId)).for("update");
    if (!u || u.role !== "student") throw new UserFacingError("That student account was not found.", "not_found", 404);

    const subs = await tx.select({ key: sub.receiptKey }).from(sub).where(eq(sub.studentId, u.userId));
    const pendingIntents = await tx.select({ key: intents.storageKey }).from(intents).where(eq(intents.studentId, u.userId));
    const counts = { submissions: subs.length, installments: (await tx.select({ id: ob.obligationId }).from(ob).where(eq(ob.studentId, u.userId))).length };

    await tx.delete(sub).where(eq(sub.studentId, u.userId)); // review rows detach (submission_id -> NULL)
    await tx.delete(ob).where(eq(ob.studentId, u.userId)); // reminders and upload intents cascade; review rows detach (obligation_id -> NULL)
    await tx.delete(emailDeliveries).where(eq(emailDeliveries.userId, u.userId)); // contains the student's email address
    const storageKeys = [...subs.map((s) => s.key), ...pendingIntents.map((i) => i.key)];
    if (storageKeys.length > 0) await tx.insert(orphanedUploads).values(storageKeys.map((storageKey) => ({ storageKey, reason: "account_deleted" }))).onConflictDoNothing();
    await tx.delete(users).where(eq(users.userId, u.userId)); // sessions, tokens, notifications cascade

    if (actorAdminId) {
      await tx.insert(adminAuditEvents).values({
        adminId: actorAdminId,
        action: "student_deleted",
        entityType: "student",
        entityId: u.userId,
        details: { studentCode: u.studentId, batch: u.batch, removedInstallments: counts.installments, removedSubmissions: counts.submissions },
      });
    }
    return storageKeys;
  });

  // Best effort now; whatever fails stays queued in orphaned_uploads for the cleanup job.
  for (const key of keys) {
    try {
      await getReceiptStorage().delete(key);
      await getDb().update(orphanedUploads).set({ deletedAt: new Date(), attempts: 1 }).where(eq(orphanedUploads.storageKey, key));
    } catch {
      /* left for cleanup */
    }
  }
}

/** A student deletes their own account. The current password must be confirmed. */
export async function deleteOwnAccount(userId: string, password: string): Promise<void> {
  const [u] = await getDb().select({ role: users.role, hash: users.passwordHash }).from(users).where(eq(users.userId, userId));
  if (!u || u.role !== "student") throw new UserFacingError("Only student accounts can be deleted here.", "forbidden", 403);
  if (!password || !(await verifyPassword(password, u.hash))) throw new UserFacingError("The password is not correct.", "wrong_password", 403);
  await removeStudent(userId, null);
}

/** An administrator deletes a student account. The administrator account itself can never be deleted this way. */
export async function deleteStudentAccount(adminId: string, studentUserId: string): Promise<void> {
  await removeStudent(studentUserId, adminId);
}

