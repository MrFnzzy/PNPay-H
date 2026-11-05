import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { cohortAlumniDate, isRolloverDue } from "@/lib/batches";
import { manilaToday } from "@/lib/payments/dates";
import { UserFacingError } from "@/lib/errors";

const { users, notifications, batchRolloverProposals, adminAuditEvents } = schema;

export async function ensureBatchRolloverProposals(today = manilaToday()) {
  const db = getDb();
  const [admin] = await db.select({ userId: users.userId }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true))).limit(1);
  if (!admin) return { created: 0 };
  const rows = await db.selectDistinct({ batch: users.batch }).from(users).where(and(eq(users.role, "student"), sql`${users.batch} ~ '^[0-9]{4}$'`));
  const pending = await db.select({ fromBatch: batchRolloverProposals.fromBatch }).from(batchRolloverProposals).where(eq(batchRolloverProposals.status, "pending"));
  const pendingSet = new Set(pending.map((row) => row.fromBatch));
  let created = 0;
  for (const row of rows) {
    if (!row.batch || !isRolloverDue(row.batch, today) || pendingSet.has(row.batch)) continue;
    const effectiveDate = cohortAlumniDate(row.batch) ?? today;
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "student"), eq(users.batch, row.batch)));
    try {
      const [proposal] = await db.insert(batchRolloverProposals).values({ fromBatch: row.batch, toBatch: "alumni", effectiveDate, affectedStudents: count }).returning({ proposalId: batchRolloverProposals.proposalId });
      await db.insert(notifications).values({ userId: admin.userId, type: "batch_rollover_proposed", title: `Batch ${row.batch} rollover needs approval`, message: `${count} student${count === 1 ? "" : "s"} in Batch ${row.batch} reached the 30-month cohort window. Review and approve the change to Alumni.`, emailPending: false, emailStatus: "not_applicable" });
      pendingSet.add(row.batch);
      created += proposal ? 1 : 0;
    } catch (error) {
      // Another admin request may have created the same proposal first; the unique pending index makes this idempotent.
      if (!(error instanceof Error && error.message.includes("batch_rollover_pending_key"))) throw error;
    }
  }
  return { created };
}

export async function listPendingBatchRolloverProposals() {
  return getDb().select().from(batchRolloverProposals).where(eq(batchRolloverProposals.status, "pending")).orderBy(asc(batchRolloverProposals.effectiveDate));
}

export async function approveBatchRollover(adminId: string, proposalId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [admin] = await tx.select({ userId: users.userId }).from(users).where(and(eq(users.userId, adminId), eq(users.role, "admin"), eq(users.isActive, true)));
    if (!admin) throw new UserFacingError("You are not allowed to approve batch changes.", "forbidden", 403);
    const [proposal] = await tx.select().from(batchRolloverProposals).where(and(eq(batchRolloverProposals.proposalId, proposalId), eq(batchRolloverProposals.status, "pending"))).for("update");
    if (!proposal) throw new UserFacingError("That batch rollover proposal is no longer pending.", "invalid_transition", 409);
    const changed = await tx.update(users).set({ batch: proposal.toBatch }).where(and(eq(users.role, "student"), eq(users.batch, proposal.fromBatch))).returning({ userId: users.userId });
    await tx.update(batchRolloverProposals).set({ status: "approved", decidedAt: new Date(), decidedBy: adminId, affectedStudents: changed.length }).where(eq(batchRolloverProposals.proposalId, proposalId));
    await tx.insert(adminAuditEvents).values({ adminId, action: "batch_rollover_approved", entityType: "batch_rollover", entityId: proposalId, details: { fromBatch: proposal.fromBatch, toBatch: proposal.toBatch, students: changed.length } });
    return { fromBatch: proposal.fromBatch, toBatch: proposal.toBatch, students: changed.length };
  });
}
