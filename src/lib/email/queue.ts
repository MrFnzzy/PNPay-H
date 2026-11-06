import { and, count, desc, eq, gt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { assertAdmin } from "@/lib/admin/review";
import { getEnv } from "@/lib/env";
import { UserFacingError } from "@/lib/errors";
import { EmailSendError, redact, sendViaProvider } from "./index";
import { notificationEmail } from "./templates";

/**
 * Email delivery worker (LLD 11.3, Phase 4).
 *
 * Notifications with email_pending = true are the queue. One run:
 *   1. CLAIMS due rows with `FOR UPDATE SKIP LOCKED` and a short lease, counting the attempt immediately, so two
 *      overlapping runs (cron + in-request trigger) can never process the same notification at the same time;
 *   2. sends through the provider with an Idempotency-Key that is stable per notification, so a crash after the provider
 *      accepted the message cannot produce a second copy on the next attempt;
 *   3. records EVERY attempt in email_deliveries (status, attempt number, redacted error - never the body);
 *   4. clears email_pending only after success (status 'sent'); a retryable failure is rescheduled with backoff; a
 *      permanent failure or exhausted retries ends as 'failed', visible to the administrator, who can retry it.
 * The worker only reads/updates notifications and email_deliveries. It never touches submissions, reviews or
 * installments, so an email problem or retry cannot change payment data or create a duplicate submission.
 */

export const MAX_EMAIL_ATTEMPTS = 5;
/** Delay before attempt n+1 after attempt n failed (minutes). */
export const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120];
export const EMAIL_LEASE_SECONDS = 120;

const { notifications: nt, users, emailDeliveries, adminAuditEvents, jobRuns } = schema;

export interface QueueResult {
  claimed: number;
  sent: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
}

type Claimed = {
  notification_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  submission_id: string | null;
  obligation_id: string | null;
  email_attempts: number;
  email_round: number;
};

export function backoffMinutes(attempt: number): number {
  return RETRY_BACKOFF_MINUTES[Math.min(attempt, RETRY_BACKOFF_MINUTES.length) - 1] ?? RETRY_BACKOFF_MINUTES.at(-1)!;
}

/** Where the email's single link goes. Relative path only; the base URL comes from APP_BASE_URL. */
function linkFor(role: "student" | "admin", c: Claimed): { path: string; label: string } {
  if (role === "admin") {
    return c.submission_id ? { path: `/admin/submissions/${c.submission_id}`, label: "Review this receipt" } : { path: "/admin/notifications", label: "Open notifications" };
  }
  if (c.type === "payment_reminder" || c.type === "installment_overdue") return { path: "/student/tracker", label: "View my payment schedule" };
  return { path: "/student/history", label: "View my payment history" };
}

async function recordAttempt(row: Claimed, to: string, status: "sent" | "failed", error: string | null) {
  await getDb().insert(emailDeliveries).values({
    userId: row.user_id,
    notificationId: row.notification_id,
    toEmail: to,
    template: `notif_${row.type}`.slice(0, 50),
    status,
    attempts: row.email_attempts,
    lastError: error,
    sentAt: status === "sent" ? new Date() : null,
  });
}

async function deliverOne(row: Claimed, now: Date, result: QueueResult): Promise<void> {
  const db = getDb();
  const [u] = await db.select({ email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive, verified: users.emailVerifiedAt }).from(users).where(eq(users.userId, row.user_id));

  // Only active accounts with a VERIFIED address are ever emailed (LLD 11.3).
  if (!u || !u.isActive || !u.verified) {
    await db
      .update(nt)
      .set({ emailPending: false, emailStatus: "not_applicable", emailLockedUntil: null, emailLastError: "recipient has no verified active email" })
      .where(and(eq(nt.notificationId, row.notification_id), eq(nt.emailPending, true)));
    result.skipped++;
    return;
  }

  const { path, label } = linkFor(u.role, row);
  const msg = notificationEmail({
    recipientName: u.fullName,
    title: row.title,
    message: row.message,
    link: `${getEnv().APP_BASE_URL}${path}`,
    linkLabel: label,
  });

  try {
    await sendViaProvider({ to: u.email, ...msg, idempotencyKey: `pnpay-notif-${row.notification_id}-r${row.email_round}` });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : "unknown error");
    const retryable = err instanceof EmailSendError ? err.retryable : true;
    console.error(`[pnpay] notification email failed (type=${row.type}, attempt=${row.email_attempts}): ${message}`);
    const exhausted = !retryable || row.email_attempts >= MAX_EMAIL_ATTEMPTS;
    if (exhausted) {
      await db
        .update(nt)
        .set({ emailPending: false, emailStatus: "failed", emailLockedUntil: null, emailNextAttemptAt: null, emailLastError: message })
        .where(and(eq(nt.notificationId, row.notification_id), eq(nt.emailPending, true)));
      result.failed++;
    } else {
      await db
        .update(nt)
        .set({ emailStatus: "queued", emailLockedUntil: null, emailNextAttemptAt: new Date(now.getTime() + backoffMinutes(row.email_attempts) * 60_000), emailLastError: message })
        .where(and(eq(nt.notificationId, row.notification_id), eq(nt.emailPending, true)));
      result.retryScheduled++;
    }
    await recordAttempt(row, u.email, "failed", message);
    return;
  }

  // Provider accepted it. The guarded update makes completion idempotent; if THIS write fails the lease expires and the
  // next attempt reuses the same Idempotency-Key, so the recipient still gets one email.
  await db
    .update(nt)
    .set({ emailPending: false, emailStatus: "sent", emailSentAt: new Date(), emailLockedUntil: null, emailNextAttemptAt: null, emailLastError: null })
    .where(and(eq(nt.notificationId, row.notification_id), eq(nt.emailPending, true)));
  await recordAttempt(row, u.email, "sent", null);
  result.sent++;
}

/** Sends due emails. Safe to call concurrently and repeatedly (cron, in-request trigger, admin button). Never throws for a send failure. */
export async function processEmailQueue(opts: { limit?: number; now?: Date } = {}): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000).toISOString();
  const result: QueueResult = { claimed: 0, sent: 0, retryScheduled: 0, failed: 0, skipped: 0 };

  const claimed = await getDb().execute<Claimed>(sql`
    UPDATE notifications n
       SET email_locked_until = ${leaseUntil}::timestamptz, email_attempts = n.email_attempts + 1
     WHERE n.notification_id IN (
       SELECT notification_id FROM notifications
        WHERE email_pending = true AND email_status = 'queued'
          AND (email_next_attempt_at IS NULL OR email_next_attempt_at <= ${nowIso}::timestamptz)
          AND (email_locked_until IS NULL OR email_locked_until < ${nowIso}::timestamptz)
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING n.notification_id, n.user_id, n.type, n.title, n.message, n.submission_id, n.obligation_id, n.email_attempts, n.email_round`);
  result.claimed = claimed.rows.length;

  for (const row of claimed.rows) {
    try {
      await deliverOne(row, now, result);
    } catch (err) {
      // A bookkeeping failure must not abort the batch; the lease expires and the row is retried (same idempotency key).
      console.error("[pnpay] email worker bookkeeping error:", err instanceof Error ? err.name : "unknown");
    }
  }
  return result;
}

/* ------------------------------------------------------------------ administrator troubleshooting */

/** Administrator: re-queue ONE failed email. Only status 'failed' can be retried, so a sent email is never re-sent. */
export async function retryFailedEmail(adminId: string, notificationId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const rows = await tx
      .update(nt)
      .set({ emailPending: true, emailStatus: "queued", emailAttempts: 0, emailRound: sql`${nt.emailRound} + 1`, emailNextAttemptAt: new Date(), emailLockedUntil: null, emailLastError: null })
      .where(and(eq(nt.notificationId, notificationId), eq(nt.emailStatus, "failed"), eq(nt.emailPending, false)))
      .returning({ id: nt.notificationId });
    if (rows.length === 0) throw new UserFacingError("Only an email that failed can be retried.", "not_failed", 409);
    await tx.insert(adminAuditEvents).values({ adminId, action: "email_retry", entityType: "notification", entityId: notificationId, details: {} });
  });
}

/** Administrator: re-queue every failed email (for example after fixing the provider configuration). */
export async function retryAllFailedEmails(adminId: string): Promise<number> {
  return getDb().transaction(async (tx) => {
    await assertAdmin(tx, adminId);
    const rows = await tx
      .update(nt)
      .set({ emailPending: true, emailStatus: "queued", emailAttempts: 0, emailRound: sql`${nt.emailRound} + 1`, emailNextAttemptAt: new Date(), emailLockedUntil: null, emailLastError: null })
      .where(and(eq(nt.emailStatus, "failed"), eq(nt.emailPending, false)))
      .returning({ id: nt.notificationId });
    if (rows.length > 0) await tx.insert(adminAuditEvents).values({ adminId, action: "email_retry_all", entityType: "notification", entityId: null, details: { count: rows.length } });
    return rows.length;
  });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export interface EmailProblemRow {
  notificationId: string;
  type: string;
  title: string;
  recipientName: string;
  recipientEmailMasked: string;
  state: "failed" | "retrying" | "waiting";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

export const STALE_QUEUE_MINUTES = 15;

/** Administrator troubleshooting view: failed emails, emails being retried, and emails waiting suspiciously long. */
export async function getEmailOverview(now: Date = new Date()) {
  const db = getDb();
  const stale = new Date(now.getTime() - STALE_QUEUE_MINUTES * 60_000);
  const [c] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${nt.emailStatus} = 'queued')::int`,
      failed: sql<number>`count(*) filter (where ${nt.emailStatus} = 'failed')::int`,
      sent: sql<number>`count(*) filter (where ${nt.emailStatus} = 'sent')::int`,
    })
    .from(nt);
  const problemWhere = or(
    eq(nt.emailStatus, "failed"),
    and(eq(nt.emailStatus, "queued"), gt(nt.emailAttempts, 0)),
    and(eq(nt.emailStatus, "queued"), sql`${nt.createdAt} < ${stale.toISOString()}::timestamptz`),
  );
  const rows = await db
    .select({
      notificationId: nt.notificationId,
      type: nt.type,
      title: nt.title,
      status: nt.emailStatus,
      attempts: nt.emailAttempts,
      lastError: nt.emailLastError,
      nextAttemptAt: nt.emailNextAttemptAt,
      createdAt: nt.createdAt,
      name: users.fullName,
      email: users.email,
    })
    .from(nt)
    .innerJoin(users, eq(users.userId, nt.userId))
    .where(problemWhere)
    .orderBy(desc(nt.createdAt))
    .limit(50);
  const problems: EmailProblemRow[] = rows.map((r) => ({
    notificationId: r.notificationId,
    type: r.type,
    title: r.title,
    recipientName: r.name,
    recipientEmailMasked: maskEmail(r.email),
    state: r.status === "failed" ? "failed" : r.attempts > 0 ? "retrying" : "waiting",
    attempts: r.attempts,
    lastError: r.lastError,
    nextAttemptAt: r.nextAttemptAt,
    createdAt: r.createdAt,
  }));
  const runs = await db
    .select({ job: jobRuns.job, startedAt: jobRuns.startedAt, ok: jobRuns.ok, summary: jobRuns.summary, error: jobRuns.error })
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(30);
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRun.has(r.job)) lastRun.set(r.job, r);
  return { counts: c ?? { queued: 0, failed: 0, sent: 0 }, problems, lastRuns: [...lastRun.values()] };
}

/** Number of emails that need the administrator's attention (dashboard badge). */
export async function countEmailsNeedingAttention(): Promise<number> {
  const [r] = await getDb().select({ n: count() }).from(nt).where(eq(nt.emailStatus, "failed"));
  return r?.n ?? 0;
}
