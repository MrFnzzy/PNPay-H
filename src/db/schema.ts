import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["student", "admin"]);
export const emailStatusEnum = pgEnum("email_status", ["queued", "sent", "failed"]);
/** Email state of one notification (LLD 12.5): not_applicable | queued (waiting, incl. retry backoff) | sent | failed (retries exhausted / permanent error). */
export const notificationEmailStatusEnum = pgEnum("notification_email_status", ["not_applicable", "queued", "sent", "failed"]);
/** Reminder kinds (LLD 11.4). */
export const reminderKindEnum = pgEnum("reminder_kind", ["due_soon", "overdue"]);
/** Receipt (submission) status - separate from the derived installment status (LLD section 9). */
export const submissionStatusEnum = pgEnum("submission_status", ["pending_review", "verified", "needs_correction", "rejected"]);
/** The three administrative decisions on a receipt (LLD section 9.2). */
export const reviewDecisionEnum = pgEnum("review_decision", ["verified", "needs_correction", "rejected"]);
export const batchRolloverStatusEnum = pgEnum("batch_rollover_status", ["pending", "approved", "rejected"]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "submission_received", // student: your receipt was received / admin: new receipt to review
  "submission_verified",
  "correction_requested",
  "submission_rejected",
  "payment_reminder",
  "installment_overdue",
  "batch_rollover_proposed",
]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Student and admin accounts. Exactly one admin may exist (partial unique index). */
export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().default(sql`gen_random_uuid()`),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    studentId: varchar("student_id", { length: 30 }),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    course: varchar("course", { length: 100 }),
    yearLevel: smallint("year_level"),
    /** Yearly cohort chosen at registration, or alumni after an approved rollover. */
    batch: varchar("batch", { length: 10 }),
    role: roleEnum("role").notNull().default("student"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_student_id_key").on(t.studentId),
    uniqueIndex("users_single_admin").on(t.role).where(sql`${t.role} = 'admin'`),
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_batch_valid", sql`${t.batch} IS NULL OR ${t.batch} = 'alumni' OR ${t.batch} ~ '^[0-9]{4}$'`),
    check("users_year_level_range", sql`${t.yearLevel} IS NULL OR ${t.yearLevel} BETWEEN 1 AND 6`),
    check("users_student_needs_student_id", sql`${t.role} = 'admin' OR ${t.studentId} IS NOT NULL`),
  ],
);

/** One scheduled installment for one student. Installment status is derived, not stored. */
export const paymentObligations = pgTable(
  "payment_obligations",
  {
    obligationId: uuid("obligation_id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.userId, { onDelete: "restrict" }),
    academicYear: varchar("academic_year", { length: 20 }).notNull(),
    periodLabel: varchar("period_label", { length: 50 }).notNull(),
    amountDue: numeric("amount_due", { precision: 10, scale: 2 }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_obligations_student_period_key").on(t.studentId, t.academicYear, t.periodLabel),
    // Phase 3: "November 2026" and "november 2026" are the same installment period (D-032).
    uniqueIndex("payment_obligations_student_period_ci_key").on(t.studentId, t.academicYear, sql`lower(${t.periodLabel})`),
    index("payment_obligations_student_due_idx").on(t.studentId, t.dueDate),
    index("payment_obligations_due_date_idx").on(t.dueDate),
    check("payment_obligations_amount_positive", sql`${t.amountDue} > 0`),
  ],
);

/** Email verification tokens. Only an HMAC of the token is stored, never the raw token. */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    tokenId: uuid("token_id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_verification_tokens_hash_key").on(t.tokenHash),
    index("email_verification_tokens_user_idx").on(t.userId),
    index("email_verification_tokens_expires_idx").on(t.expiresAt),
  ],
);

/** Server-side sessions. Cookie holds a random token; only its HMAC is stored. Deleting the row = logout. */
export const sessions = pgTable(
  "sessions",
  {
    sessionId: uuid("session_id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/** Email delivery attempts for failure logging and retry. Never stores bodies or tokens. */
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    deliveryId: uuid("delivery_id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.userId, { onDelete: "set null" }),
    /** Phase 4: the notification this attempt belongs to (one row per ATTEMPT for notification emails). */
    notificationId: uuid("notification_id").references((): AnyPgColumn => notifications.notificationId, { onDelete: "set null" }),
    toEmail: varchar("to_email", { length: 254 }).notNull(),
    template: varchar("template", { length: 50 }).notNull(),
    status: emailStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: varchar("last_error", { length: 500 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    index("email_deliveries_status_idx").on(t.status, t.createdAt),
    index("email_deliveries_user_idx").on(t.userId),
    index("email_deliveries_notification_idx").on(t.notificationId, t.createdAt),
  ],
);

/** Database-backed rate limiting that works across serverless instances. */
export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    eventId: bigserial("event_id", { mode: "number" }).primaryKey(),
    key: varchar("key", { length: 200 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("rate_limit_events_key_idx").on(t.key, t.createdAt)],
);

/**
 * One uploaded receipt for one installment (Phase 2). Receipt bytes live in private object storage;
 * only the storage key and validated metadata are kept here. Partial unique indexes enforce the
 * "one open submission per installment" and "no duplicate counted transaction" rules in the database.
 */
export const paymentSubmissions = pgTable(
  "payment_submissions",
  {
    submissionId: uuid("submission_id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.userId, { onDelete: "restrict" }),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => paymentObligations.obligationId, { onDelete: "restrict" }),
    /** Earlier submission this one replaces (Needs Correction / Rejected). */
    previousSubmissionId: uuid("previous_submission_id").references((): AnyPgColumn => paymentSubmissions.submissionId, { onDelete: "set null" }),
    /** Snapshot of the installment amount at submission time (never supplied by the student). */
    amountSubmitted: numeric("amount_submitted", { precision: 10, scale: 2 }).notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
    referenceNumber: varchar("reference_number", { length: 40 }),
    /** Upper-cased, separators removed; used for duplicate detection. */
    referenceNormalized: varchar("reference_normalized", { length: 40 }),
    receiptKey: varchar("receipt_key", { length: 200 }).notNull(),
    receiptMime: varchar("receipt_mime", { length: 20 }).notNull(),
    receiptSize: integer("receipt_size").notNull(),
    receiptSha256: varchar("receipt_sha256", { length: 64 }).notNull(),
    status: submissionStatusEnum("status").notNull().default("pending_review"),
    /** Reviewer remarks, written by the administrator's review decision (Phase 3). */
    remarks: varchar("remarks", { length: 1000 }),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    reviewedAt: ts("reviewed_at"),
  },
  (t) => [
    index("payment_submissions_student_idx").on(t.studentId, t.submittedAt),
    index("payment_submissions_obligation_idx").on(t.obligationId),
    index("payment_submissions_status_idx").on(t.status, t.submittedAt),
    // At most one open (pending or verified) submission per installment -> blocks double submit and re-pay of a paid installment.
    uniqueIndex("payment_submissions_one_open_per_obligation")
      .on(t.obligationId)
      .where(sql`${t.status} IN ('pending_review','verified')`),
    // The same transaction reference cannot be counted twice.
    uniqueIndex("payment_submissions_open_reference_key")
      .on(t.referenceNormalized)
      .where(sql`${t.referenceNormalized} IS NOT NULL AND ${t.status} IN ('pending_review','verified')`),
    // The same receipt image cannot be counted twice.
    uniqueIndex("payment_submissions_open_receipt_hash_key")
      .on(t.receiptSha256)
      .where(sql`${t.status} IN ('pending_review','verified')`),
    uniqueIndex("payment_submissions_receipt_key_key").on(t.receiptKey),
    check("payment_submissions_amount_positive", sql`${t.amountSubmitted} > 0`),
    check("payment_submissions_size_positive", sql`${t.receiptSize} > 0`),
  ],
);

/** In-app payment notifications (admin and student). Email delivery is added in Phase 4. */
export const notifications = pgTable(
  "notifications",
  {
    notificationId: uuid("notification_id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    message: varchar("message", { length: 500 }).notNull(),
    submissionId: uuid("submission_id").references(() => paymentSubmissions.submissionId, { onDelete: "set null" }),
    obligationId: uuid("obligation_id").references(() => paymentObligations.obligationId, { onDelete: "set null" }),
    isRead: boolean("is_read").notNull().default(false),
    readAt: ts("read_at"),
    /** True while the email worker should still try to send (first attempt or retry). Cleared on success or when retries are exhausted. */
    emailPending: boolean("email_pending").notNull().default(false),
    /** LLD 12.5 email_status. Invariant (check constraint): email_pending => email_status = 'queued'. */
    emailStatus: notificationEmailStatusEnum("email_status").notNull().default("not_applicable"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    /** Incremented by an administrator's manual retry; part of the provider idempotency key. */
    emailRound: integer("email_round").notNull().default(0),
    emailNextAttemptAt: ts("email_next_attempt_at"),
    /** Short lease so two workers never send the same notification at once. */
    emailLockedUntil: ts("email_locked_until"),
    emailLastError: varchar("email_last_error", { length: 500 }),
    emailSentAt: ts("email_sent_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.isRead, t.createdAt),
    index("notifications_email_pending_idx").on(t.emailPending),
    index("notifications_email_queue_idx").on(t.emailNextAttemptAt).where(sql`${t.emailPending} = true`),
    index("notifications_email_status_idx").on(t.emailStatus, t.createdAt),
    check("notifications_email_state", sql`${t.emailPending} = false OR ${t.emailStatus} = 'queued'`),
  ],
);

/**
 * Short-lived, server-issued permission to upload ONE receipt object for ONE installment.
 * The storage key is generated by the server; the client never chooses it.
 */
export const receiptUploadIntents = pgTable(
  "receipt_upload_intents",
  {
    intentId: uuid("intent_id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => paymentObligations.obligationId, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 200 }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("receipt_upload_intents_key_key").on(t.storageKey), index("receipt_upload_intents_student_idx").on(t.studentId, t.createdAt), index("receipt_upload_intents_expiry_idx").on(t.expiresAt)],
);

/** Storage objects whose cleanup failed or is pending; processed by `npm run cleanup:uploads`. */
export const orphanedUploads = pgTable(
  "orphaned_uploads",
  {
    orphanId: uuid("orphan_id").primaryKey().default(sql`gen_random_uuid()`),
    storageKey: varchar("storage_key", { length: 200 }).notNull(),
    reason: varchar("reason", { length: 100 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("orphaned_uploads_key_key").on(t.storageKey), index("orphaned_uploads_pending_idx").on(t.deletedAt)],
);

/**
 * Append-only history of administrative review decisions (LLD 12.4). One row per decision; a database trigger
 * rejects UPDATE and DELETE, and a unique index allows exactly one review per submission in Phase 3 because a
 * submission can only be reviewed from Pending Review (D-031).
 */
export const paymentReviews = pgTable(
  "payment_reviews",
  {
    reviewId: uuid("review_id").primaryKey().default(sql`gen_random_uuid()`),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => paymentSubmissions.submissionId, { onDelete: "restrict" }),
    /** The installment the submission belongs to (kept for audit even if the schedule is later edited). */
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => paymentObligations.obligationId, { onDelete: "restrict" }),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.userId, { onDelete: "restrict" }),
    decision: reviewDecisionEnum("decision").notNull(),
    previousStatus: submissionStatusEnum("previous_status").notNull(),
    remarks: varchar("remarks", { length: 1000 }),
    reviewedAt: ts("reviewed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_reviews_one_per_submission").on(t.submissionId),
    index("payment_reviews_admin_idx").on(t.adminId, t.reviewedAt),
    index("payment_reviews_obligation_idx").on(t.obligationId),
    check("payment_reviews_remarks_required", sql`${t.decision} = 'verified' OR length(btrim(coalesce(${t.remarks}, ''))) > 0`),
  ],
);

/** Important administrative changes that are not review decisions (schedule create / edit / remove). Append-only by trigger. */
export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    eventId: uuid("event_id").primaryKey().default(sql`gen_random_uuid()`),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.userId, { onDelete: "restrict" }),
    action: varchar("action", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 30 }).notNull(),
    entityId: uuid("entity_id"),
    /** Before/after values and counts. Never contains receipts, tokens or passwords. */
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("admin_audit_events_created_idx").on(t.createdAt), index("admin_audit_events_entity_idx").on(t.entityType, t.entityId)],
);

/**
 * Reminder de-duplication (LLD 11.4, Phase 4). One row per (installment, reminder kind, due date): the unique
 * constraint is what guarantees a reminder is never created twice, even with concurrent job runs. The due date
 * is part of the key so a rescheduled installment gets a fresh reminder period.
 */
export const paymentReminders = pgTable(
  "payment_reminders",
  {
    reminderId: uuid("reminder_id").primaryKey().default(sql`gen_random_uuid()`),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => paymentObligations.obligationId, { onDelete: "cascade" }),
    kind: reminderKindEnum("kind").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    notificationId: uuid("notification_id").references(() => notifications.notificationId, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_reminders_once").on(t.obligationId, t.kind, t.dueDate), index("payment_reminders_created_idx").on(t.createdAt)],
);

/** Scheduled-job run log (Vercel Cron). Lets the administrator see whether the jobs are actually running. */
export const jobRuns = pgTable(
  "job_runs",
  {
    runId: uuid("run_id").primaryKey().default(sql`gen_random_uuid()`),
    job: varchar("job", { length: 40 }).notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    ok: boolean("ok"),
    /** Counts only (e.g. reminders created, emails sent). Never recipients, bodies or tokens. */
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    error: varchar("error", { length: 300 }),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Receipt image bytes when RECEIPT_STORAGE=postgres. Private: only ever read through the server's ownership-checked route. */
export const receiptFiles = pgTable("receipt_files", {
  storageKey: varchar("storage_key", { length: 200 }).primaryKey(),
  contentType: varchar("content_type", { length: 50 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});


/** Approval gate for automatic cohort-to-alumni transitions. Payment history remains on the student. */
export const batchRolloverProposals = pgTable(
  "batch_rollover_proposals",
  {
    proposalId: uuid("proposal_id").primaryKey().default(sql`gen_random_uuid()`),
    fromBatch: varchar("from_batch", { length: 10 }).notNull(),
    toBatch: varchar("to_batch", { length: 10 }).notNull().default("alumni"),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    affectedStudents: integer("affected_students").notNull().default(0),
    status: batchRolloverStatusEnum("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    decidedBy: uuid("decided_by").references(() => users.userId, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("batch_rollover_pending_key").on(t.fromBatch).where(sql`${t.status} = 'pending'`),
    index("batch_rollover_status_idx").on(t.status, t.createdAt),
  ],
);
