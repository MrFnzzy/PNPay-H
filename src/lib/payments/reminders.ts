import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getEnv } from "@/lib/env";
import { addDays, formatDate, manilaToday } from "./dates";
import { emailQueued } from "./events";
import { formatPeso, toCents } from "./money";

/**
 * Payment reminders (LLD 11.4, Phase 4).
 *
 *  - due_soon: LLD default - an installment due within REMINDER_DAYS_BEFORE days (default 5), counting today.
 *    Using a window (not "exactly 5 days") means one missed cron run does not silently lose a reminder.
 *  - overdue: only when OVERDUE_REMINDERS_ENABLED=1, i.e. once Miss Jean has approved overdue reminders (OPEN-15).
 *    One notice per installment (per due date); no repeating schedule is invented.
 *
 * Eligible installments: unpaid AND not awaiting review (D-044: a student who already submitted a receipt is not told
 * to pay), for ACTIVE students with a VERIFIED email. De-duplication is the unique index payment_reminders_once
 * (installment, kind, due date): the reminder row, the in-app notification and the queued email are created in ONE
 * transaction, so concurrent job runs create each reminder exactly once. The email itself is sent by the email worker.
 */

const { paymentObligations: ob, paymentSubmissions: sub, paymentReminders: rem, notifications } = schema;

export type ReminderKind = "due_soon" | "overdue";

export interface ReminderOptions {
  now?: Date;
  daysBefore?: number;
  overdueEnabled?: boolean;
}

export interface ReminderSummary {
  dueSoonCreated: number;
  overdueCreated: number;
  skipped: number;
}

type Candidate = { obligation_id: string; student_id: string; period_label: string; amount_due: string; due_date: string };

async function createReminder(c: Candidate, kind: ReminderKind): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    // Same lock order as submit/review (installment first). Re-check under the lock: the student may have just submitted.
    const [o] = await tx.select().from(ob).where(eq(ob.obligationId, c.obligation_id)).for("update");
    if (!o || o.dueDate !== c.due_date) return false;
    const open = await tx
      .select({ id: sub.submissionId })
      .from(sub)
      .where(and(eq(sub.obligationId, c.obligation_id), inArray(sub.status, ["verified", "pending_review"])))
      .limit(1);
    if (open.length > 0) return false;

    const [r] = await tx.insert(rem).values({ obligationId: c.obligation_id, kind, dueDate: c.due_date }).onConflictDoNothing().returning({ id: rem.reminderId });
    if (!r) return false; // already reminded for this installment and due date

    const amount = formatPeso(toCents(c.amount_due));
    const when = formatDate(c.due_date);
    const [n] = await tx
      .insert(notifications)
      .values({
        userId: c.student_id,
        type: kind === "due_soon" ? "payment_reminder" : "installment_overdue",
        title: kind === "due_soon" ? "Payment due soon" : "Payment overdue",
        message:
          kind === "due_soon"
            ? `Your ${c.period_label} installment of ${amount} is due on ${when}.`
            : `Your ${c.period_label} installment of ${amount} was due on ${when} and has not been paid yet.`,
        obligationId: c.obligation_id,
        ...emailQueued(),
      })
      .returning({ id: notifications.notificationId });
    await tx.update(rem).set({ notificationId: n.id }).where(eq(rem.reminderId, r.id));
    return true;
  });
}

export async function runPaymentReminders(opts: ReminderOptions = {}): Promise<ReminderSummary> {
  const env = getEnv();
  const today = manilaToday(opts.now);
  const daysBefore = opts.daysBefore ?? env.REMINDER_DAYS_BEFORE;
  const overdueEnabled = opts.overdueEnabled ?? env.OVERDUE_REMINDERS_ENABLED === "1";
  const db = getDb();
  const summary: ReminderSummary = { dueSoonCreated: 0, overdueCreated: 0, skipped: 0 };

  const select = (kind: ReminderKind, dueFilter: ReturnType<typeof sql>) =>
    db.execute<Candidate>(sql`
      SELECT o.obligation_id, o.student_id, o.period_label, o.amount_due::text AS amount_due, o.due_date::text AS due_date
        FROM payment_obligations o
        JOIN users u ON u.user_id = o.student_id AND u.role = 'student' AND u.is_active AND u.email_verified_at IS NOT NULL
       WHERE ${dueFilter}
         AND NOT EXISTS (SELECT 1 FROM payment_submissions s WHERE s.obligation_id = o.obligation_id AND s.status IN ('verified', 'pending_review'))
         AND NOT EXISTS (SELECT 1 FROM payment_reminders r WHERE r.obligation_id = o.obligation_id AND r.kind = ${kind}::reminder_kind AND r.due_date = o.due_date)
       ORDER BY o.due_date, o.created_at
       LIMIT 1000`);

  const until = addDays(today, daysBefore);
  const upcoming = await select("due_soon", sql`o.due_date >= ${today}::date AND o.due_date <= ${until}::date`);
  for (const c of upcoming.rows) (await createReminder(c, "due_soon")) ? summary.dueSoonCreated++ : summary.skipped++;

  if (overdueEnabled) {
    const late = await select("overdue", sql`o.due_date < ${today}::date`);
    for (const c of late.rows) (await createReminder(c, "overdue")) ? summary.overdueCreated++ : summary.skipped++;
  }
  return summary;
}
