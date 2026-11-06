# PROJECT_CONTEXT — PNPay-H

Last updated: 2026-11-05 (end of Phase 4 - FINAL package; the Phase 1-3 sections below are still accurate and Phase 4 is appended at the bottom)

## Purpose
Student payment record and receipt verification system. Students pay externally (GCash etc.), then submit receipt screenshots; the single
administrator (Miss Jean) verifies/rejects/requests corrections. The site never processes payments. Source of truth: the 19-page LLD
(`LLD_Yaun_Jimenez_Satuito_Cinco.docx`) plus the Master Development Instructions. A copy of the LLD is kept in `docs/source/PNPay-H_LLD.docx`.

## Stack
Next.js 15.5 (App Router, server actions) · React 19 · TypeScript (strict) · Drizzle ORM 0.44 + node-postgres · PostgreSQL ·
zod validation · Resend (HTTP API via fetch, no SDK) · Vitest + embedded-postgres (tests) · Playwright (E2E, external) · Vercel + GitHub.
No UI framework; plain CSS in `src/app/globals.css`.
Decision history in `DECISIONS.md` (Drizzle chosen because Prisma's engine binaries could not be downloaded in the build sandbox).

## Architecture
- **Routes** (`src/app`): `/` · `/register` · `/login` · `/admin/login` · `/verify-email?token=` · `/resend-verification` ·
  `/student/dashboard` (placeholder) · `/admin/dashboard` (placeholder) · `/api/health`.
- **Server actions** (`src/app/actions/auth.ts`): register, student login, admin login, logout, resend, verify. Forms use `useActionState`.
- **Auth core** (`src/lib/auth/service.ts`) is framework-free and unit-testable: `registerStudent`, `verifyEmailToken`, `resendVerification`,
  `authenticate(email, password, expectedRole)`, `createSession`, `getSessionUser`, `destroySession`.
  `src/lib/auth/session.ts` is the Next.js glue (cookies, `requireRole`).
- **Authorization**: `requireRole(role)` is called in layouts AND pages (and MUST be called in every future server action / route handler).
  `src/middleware.ts` only redirects requests with no cookie; it is not a security boundary.
- **Sessions**: opaque 256-bit random token in cookie `pnpay_session` (HttpOnly, SameSite=Lax, Secure in production). DB stores HMAC-SHA256(token, AUTH_SECRET).
  Logout deletes the row. Login always issues a new token and deletes the presented one (fixation protection). TTL: student 7 days, admin 8 hours.
- **Passwords**: scrypt (N=32768, r=8, p=1, 16-byte salt) via `node:crypto`; format `scrypt$N$r$p$salt$hash`.
- **Email verification**: 256-bit token, HMAC stored, 24 h TTL, atomic one-time consumption (`UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING`).
  The link opens a page with a confirm button (POST) so email link-scanners can't burn the token. One live token per user.
- **Rate limiting**: `rate_limit_events` table. Login: 5 failures / 15 min / email, 20 / IP. Resend: 3/h/email, 10/h/IP. Register: 10/h/IP.
- **Email**: `sendTrackedEmail` writes a row to `email_deliveries` (queued→sent/failed, attempts, redacted error). Providers: `resend` (prod), `file` (dev, `.dev-mail/`), `memory` (tests).
  Bodies/tokens are never stored or logged.
- **Env validation**: `src/lib/env.ts`, lazy (first runtime use) so `next build` needs no secrets. Production requires `EMAIL_PROVIDER=resend` and an https `APP_BASE_URL`.

## Database (migration `drizzle/0000_init.sql`)
| Table | Purpose |
|---|---|
| `users` | accounts. `user_id` uuid PK; unique `email` (lowercase check) and `student_id`; `role` enum student/admin; partial unique index `users_single_admin` (only one admin); check: students must have a student_id; year_level 1–6; `course` nullable. |
| `payment_obligations` | scheduled installments (schema only in Phase 1). FK→users (RESTRICT), unique (student_id, academic_year, period_label), amount_due > 0, indexes on (student_id, due_date) and due_date. Installment status is derived, not stored. |
| `email_verification_tokens` | token_hash (unique), expires_at, used_at, FK cascade. |
| `sessions` | token_hash (unique), expires_at, FK cascade. *(added)* |
| `email_deliveries` | email attempt log for failure recording + retry. *(added)* |
| `rate_limit_events` | DB-backed rate limiting. *(added)* |

Still to add in later phases (per LLD §12 and Master §8): `payment_submissions`, `payment_reviews`, `notifications`, reminder de-duplication, audit events.
Migrations: edit `src/db/schema.ts` → `npm run db:generate` → commit the SQL in `drizzle/` → `npm run db:migrate`. Never change production by hand.

## Directory structure
See README.md. Tests: `tests/auth.test.ts` (34 integration tests on a real Postgres), `tests/e2e/run.ts` (21 browser checks), helpers in `tests/helpers/`.

## Integrations / environment variables
See `.env.example` and `docs/DEPLOYMENT.md`. Phase 1 needs: `DATABASE_URL`, `AUTH_SECRET`, `APP_BASE_URL`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`.
Phase 2 will add private receipt object storage (Vercel Blob proposed; see DECISIONS.md D-012). `ADMIN_*` are read only by `scripts/create-admin.ts`.

## Conventions for later phases
- Take the student identity ONLY from the session; never from form data. Re-verify ownership of every record in the query (`WHERE student_id = session.userId`).
- Every server action / route handler starts with `requireRole(...)`.
- Money is `numeric(10,2)`; never floats. Dates for due dates are `date` (Asia/Manila calendar dates).
- Don't hardcode the ₱500 amount, installment count or annual total; read from the database.
- Never log tokens, passwords, or receipt content.


---
## Phase 2 additions (student portal and receipt submission)

### New routes
`/student/dashboard`, `/student/tracker`, `/student/calendar`, `/student/submit`, `/student/history`, `/student/notifications` (all call `requireRole("student")`; data comes from `src/lib/payments/queries.ts`, always filtered by the session user id - no page accepts a student id from the URL).
API: `POST /api/receipts/intent`, `POST /api/receipts/blob-token` (Vercel Blob client-upload token), `PUT /api/receipts/upload/[intentId]` (local/memory providers only), `GET /api/receipts/[submissionId]` (owner-only receipt stream). Route-handler auth helper: `src/lib/auth/api.ts` (student role only, same-origin check on mutations).
Server actions: `src/app/actions/student.ts` (`submitReceiptAction`, `markNotificationReadAction`, `markAllNotificationsReadAction`).

### New code
- `src/lib/payments/status.ts` - derived installment status (never stored), overdue counting, eligibility.
- `src/lib/payments/queries.ts` - dashboard, installments, history, recent transactions, notifications. Every function takes `studentId`.
- `src/lib/payments/submit.ts` - `createUploadIntent`, `submitReceipt` (verification, transaction, cleanup), `cleanupUploads`.
- `src/lib/payments/events.ts` - `dispatchPaymentEvent`: notifications written in the same transaction; `email_pending` rows are the Phase 4 email queue. Review events for Phase 3 are already defined.
- `src/lib/payments/{validation,receipt-file,dates,money}.ts`.
- `src/lib/storage/*` - `ReceiptStorage` interface; providers `vercel-blob` (private), `local` (dev), `memory` (tests).
- `src/components/student/*` - StudentPage, StatusPill, PaymentCalendar (client, read-only), ReceiptForm (client).

### Database (migration `drizzle/0001_phase2_student_portal.sql`)
New enums `submission_status`, `notification_type`. New tables:
- `payment_submissions` - receipt metadata (key, mime, size, sha256), status, remarks, `previous_submission_id`. Partial unique indexes enforce: one Pending/Verified submission per installment; no repeated reference; no repeated image hash.
- `notifications` - in-app notifications for students and the admin, `email_pending` flag.
- `receipt_upload_intents` - server-issued, short-lived upload authorizations (server-generated storage key).
- `orphaned_uploads` - storage objects whose deletion failed; retried by `npm run cleanup:uploads`.
Existing tables unchanged.

### Storage architecture
Browser -> (intent) -> server issues key + authorization -> browser uploads directly to private Vercel Blob -> form action re-reads the object, checks size / magic bytes / sha256 -> one DB transaction (lock installment row, consume intent, insert submission, insert notifications). Receipts are streamed back only by `GET /api/receipts/[id]` with `Cache-Control: no-store`, `nosniff`, sandbox CSP. No public URL is ever produced or stored.

### Env additions
`RECEIPT_STORAGE`, `BLOB_READ_WRITE_TOKEN`, `RECEIPT_MAX_BYTES`, `RECEIPT_LOCAL_DIR`, `ALLOW_NON_PRODUCTION_STORAGE` (test only).


---
## Phase 3 additions (admin portal and receipt verification)

### New routes (all under `src/app/admin/(portal)/`, all guarded by the layout AND `requireRole("admin")` in each page)
`/admin/dashboard` (live counts, review queue, overdue, upcoming 30 days, recent activity, notifications) · `/admin/records` (search by name/ID, year level, due month, payment-date range, receipt status, installment status, sort, pagination; GET form - read-only) · `/admin/submissions/[id]` (full details, receipt image, history chain with decisions, review form) · `/admin/students/[id]` (one student's totals, installments, submission history) · `/admin/schedules` (create installments; grouped overview) · `/admin/schedules/[obligationId]` (edit, remove unused, change history) · `/admin/notifications`.
`GET /api/receipts/[submissionId]` now serves the owner (student) OR the administrator (role from the server session).
Server actions: `src/app/actions/admin.ts` (`reviewSubmissionAction`, `createScheduleAction`, `updateObligationAction`, `deleteObligationAction`, mark-notification actions). Each starts with `requireRole("admin")` and reads only whitelisted form fields; the actor is the session user.

### New code
- `src/lib/admin/review.ts` - `reviewSubmission` (THE transactional decision), `getSubmissionDetails`, `getReceiptForAdmin`, `assertAdmin`.
- `src/lib/admin/records.ts` - `parseRecordFilters`, `listRecords` (parameterized, whitelisted sort, pagination), `getAdminDashboard`, `getStudentHeader`. Contains the SQL twin of `deriveInstallmentStatus`.
- `src/lib/admin/schedules.ts` - `createSchedule`, `updateObligation`, `deleteObligation`, `editRules`, `getObligationForEdit`, `listScheduleGroups`.
- `src/lib/auth/api.ts` - added `getApiAdmin`. `src/components/admin/*` (AdminPage, ReviewForm, ScheduleForms). `PortalShell` now has an admin nav.

### Review transaction (`reviewSubmission`) - order of operations
validate input (remarks rules) -> BEGIN -> assert active admin -> load installment `FOR UPDATE` -> load submission `FOR UPDATE` -> submission/installment/student must agree -> status must be `pending_review` -> (verify only) amount equals the submission snapshot, no other verified payment for the installment, reference and image hash not already counted -> conditional `UPDATE ... WHERE status='pending_review'` -> insert `payment_reviews` -> `dispatchPaymentEvent` (student notification, `email_pending`) -> derive installment status -> COMMIT. Any error rolls everything back; an unexpected error is logged server-side (code only), an audit event `review_failed` is written afterwards, and the user sees "Nothing was changed".

### Database (migration `drizzle/0002_phase3_admin_review.sql`)
- enum `review_decision`; table `payment_reviews` (review_id, submission_id, obligation_id, admin_id, decision, previous_status, remarks, reviewed_at; unique one-per-submission; remarks check; all FKs RESTRICT).
- table `admin_audit_events` (event_id, admin_id, action, entity_type, entity_id, details jsonb, created_at) - supporting table for schedule changes and `review_failed`.
- function `pnpay_forbid_change()` + triggers making both tables append-only (UPDATE/DELETE raise error 42501).
- unique index `payment_obligations_student_period_ci_key` on (student_id, academic_year, lower(period_label)).
Existing tables, the Phase 2 partial unique indexes and Phase 1 auth were not changed.

### Rules the next phase must keep
Everything under "Conventions for later phases" above, plus: installment status is derived (D-030); only `pending_review` is reviewable (D-031); every admin entry point calls `requireRole("admin")` and any new service re-checks the actor (D-039); no new place may serve a receipt except `/api/receipts/[id]`; review history and audit tables are append-only; never edit a verified payment or the schedule of a Paid installment (D-034).


---
## Phase 4 additions (notifications, email delivery, reminders, scheduled jobs, hardening)

### New routes
`/admin/email` (failed / retrying / waiting emails, retry buttons, scheduled-job log; admin only). `GET /api/cron/{daily,reminders,email,cleanup}` (secret-protected, GET only). Student/admin notification pages unchanged except links: reminders link to `/student/tracker#o-<obligationId>`; admin nav has "Email delivery"; admin dashboard has an "Emails needing attention" card.
Admin server actions added in `src/app/actions/admin.ts`: `retryEmailAction`, `retryAllFailedEmailsAction`, `processEmailQueueNowAction` (each `requireRole("admin")`; services re-check the actor).

### New code
- `src/lib/email/queue.ts` - `processEmailQueue` (claim with lease + SKIP LOCKED, send, record attempt, backoff), `retryFailedEmail`, `retryAllFailedEmails`, `getEmailOverview`, `countEmailsNeedingAttention`.
- `src/lib/email/index.ts` - `sendViaProvider` (was `transport`), `EmailSendError{retryable}`, Idempotency-Key; `sendTrackedEmail` (verification emails) unchanged. `templates.ts` - `notificationEmail`. `schedule.ts` - `scheduleEmailDelivery()` (Next `after`).
- `src/lib/payments/reminders.ts` - `runPaymentReminders`. `src/lib/payments/events.ts` - `emailQueued()` helper; admin title for resubmissions.
- `src/lib/jobs.ts` - `runJob` (records `job_runs`). `src/lib/cron.ts` - `authorizeCron`, job table. `src/lib/env.ts` - `CRON_SECRET`, `REMINDER_DAYS_BEFORE`, `OVERDUE_REMINDERS_ENABLED`.

### Database (migration `drizzle/0003_phase4_notifications_email.sql`)
- enums `notification_email_status`, `reminder_kind`.
- `notifications` + `email_status`, `email_attempts`, `email_round`, `email_next_attempt_at`, `email_locked_until`, `email_last_error`, `email_sent_at`; check `notifications_email_state` (pending => queued); partial index for the queue. Backfill of Phase 2-3 pending rows is in the SQL BEFORE the check.
- `email_deliveries` + `notification_id` (FK set null): one row per attempt for notification emails.
- NEW `payment_reminders` (unique obligation+kind+due_date; FK cascade to obligation, set null to notification) - reminder de-duplication.
- NEW `job_runs` - scheduled-job log (counts / error code only).

### Flow
Event (same transaction as the payment change) -> notification row with `email_pending` -> after commit `scheduleEmailDelivery()` (+ daily cron, + admin button) -> worker -> provider -> attempt row -> success / backoff / failed -> admin sees failures. A provider outage can never fail or roll back a payment action or create a submission.

### Rules the maintainer must keep
Everything in D-016..D-041 plus D-042..D-047: never send email inside a payment transaction; never clear `email_pending` except on success/exhaustion/not-applicable; never log message bodies, tokens, remarks or reference numbers; only status `failed` is retriable; reminder dedup lives in the unique index, not in application logic; cron routes stay GET-only and fail closed.
