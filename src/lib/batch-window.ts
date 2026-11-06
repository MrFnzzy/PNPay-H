import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { assertAdmin } from "@/lib/admin/review";
import { cohortStartDate, computeActiveBatches, isNewBatchDue, nextBatchCandidate } from "@/lib/batches";
import { UserFacingError } from "@/lib/errors";
import { manilaToday } from "@/lib/payments/dates";

const { adminAuditEvents, batchRolloverProposals } = schema;

type Db = ReturnType<typeof getDb>;

/** Reads the window from existing tables only: admin-approved "batch_opened" audit events and approved rollovers. */
async function loadWindow(db: Db) {
  const [events, retiredRows] = await Promise.all([
    db.select({ details: adminAuditEvents.details }).from(adminAuditEvents).where(eq(adminAuditEvents.action, "batch_opened")),
    db.select({ fromBatch: batchRolloverProposals.fromBatch }).from(batchRolloverProposals).where(eq(batchRolloverProposals.status, "approved")),
  ]);
  const opened = events.map((e) => (e.details as { batch?: unknown } | null)?.batch).filter((b): b is string => typeof b === "string");
  const retired = retiredRows.map((r) => r.fromBatch);
  return { opened, retired };
}

/** The yearly batches students can currently join (for example 2027, 2028, 2029). */
export async function getActiveBatches(): Promise<string[]> {
  const { opened, retired } = await loadWindow(getDb());
  return computeActiveBatches(opened, retired);
}

/** Active batches plus Alumni: what every batch dropdown offers. */
export async function getBatchOptions(): Promise<string[]> {
  return [...(await getActiveBatches()), "alumni"];
}

/** The next batch waiting for the administrator's approval, or null while it is not yet time (or nothing is waiting). */
export async function getPendingNewBatch(today = manilaToday()): Promise<{ batch: string; startDate: string } | null> {
  const { opened, retired } = await loadWindow(getDb());
  const batch = nextBatchCandidate(opened, retired);
  if (!isNewBatchDue(batch, today)) return null;
  return { batch, startDate: cohortStartDate(batch)! };
}

/** Admin approval: opens the next yearly batch. Only the batch the system is currently proposing can be opened. */
export async function openNextBatch(adminId: string, batch: string, today = manilaToday()): Promise<{ batch: string }> {
  return getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const { opened, retired } = await loadWindow(tx as unknown as Db);
    const candidate = nextBatchCandidate(opened, retired);
    if (batch !== candidate || !isNewBatchDue(candidate, today)) throw new UserFacingError("That batch is not waiting for approval (it may already be open).", "invalid_transition", 409);
    await tx.insert(adminAuditEvents).values({ adminId, action: "batch_opened", entityType: "batch", entityId: null, details: { batch: candidate, cohortStart: cohortStartDate(candidate) } });
    return { batch: candidate };
  });
}
