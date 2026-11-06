# PNPay-H — Student Payment Verification System

Students pay through GCash (or another payment app) and submit their receipt screenshot here.
The administrator (Miss Jean) reviews and verifies receipts. **The site never processes payments.**

Status: **Phase 4 of 4 built and tested locally - PARTIALLY COMPLETE overall** because GitHub push, Vercel deployment and live Blob/Resend verification need your accounts (see `docs/DEPLOYMENT.md`). Phase 1: foundation, registration, email verification, authentication. Phase 2: student portal, receipt submission, private receipt storage. Phase 3: admin portal, schedules, transactional receipt review. Phase 4: in-app + email notifications with retry, payment reminders, scheduled jobs, security hardening.
See `BUILD_PROGRESS.md` for the exact state and `PHASE_HANDOFF_INSTRUCTIONS.md` to continue.

## Stack
Next.js 15 (App Router) · TypeScript · Drizzle ORM + `pg` · PostgreSQL · email via Nodemailer SMTP (free, e.g. Gmail) or Resend · Vercel.

## Quick start (local)
Requirements: Node 20.12+ and a PostgreSQL database (local or managed, e.g. Neon).

```bash
npm ci
cp .env.example .env.local       # then fill in real values (never commit it)
npm run db:migrate               # applies ./drizzle migrations
npm run admin:create             # one-time controlled admin setup (reads ADMIN_* from .env.local)
npm run dev                      # http://localhost:3000
```
With `EMAIL_PROVIDER=file`, verification emails are written to `.dev-mail/` instead of being sent.

## Scripts
| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development / production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit + integration tests (starts a throwaway embedded PostgreSQL; needs a non-root OS user) |
| `npm run build && npm run test:e2e` | Real-browser end-to-end test against the production build (needs Playwright + Chromium) |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run admin:create [-- --reset-password]` | Create (or reset the password of) the single administrator |
| `npm run seed:dev -- --email <student> --amount 500 --months 10 --start 2026-08-15` | DEV ONLY: create test installments for a student (refuses production) |
| `npm run cleanup:uploads` | Delete receipt uploads that were authorized but never submitted; retry failed deletions (also runs daily from cron) |

Set `TEST_DATABASE_URL` to run `npm test` against a disposable database instead of the embedded one.

## Structure
```
src/app/            routes (api/cron/*, admin/email, register, login, admin/login, verify-email, resend-verification, student/{dashboard,tracker,calendar,submit,history,notifications}, admin/{dashboard,records,students/[id],submissions/[id],schedules,schedules/[id],notifications}, api/health, api/receipts/*)
src/app/actions/    server actions (form handlers)
src/components/     reusable UI
src/db/             Drizzle schema + connection
src/lib/            env validation, validation schemas, rate limiting, email, auth (service, passwords, tokens, session, api)
src/lib/payments/   installment status rules, dashboard/history queries, receipt submission, events/notifications
src/lib/email/      provider layer, templates, queue worker (queue.ts), after() trigger
src/lib/storage/    private receipt storage (vercel-blob, local, memory)
src/middleware.ts   coarse redirect for requests with no session cookie
drizzle/            SQL migrations (committed; apply with db:migrate)
scripts/            migrate.ts, create-admin.ts, seed-dev-schedule.ts, cleanup-uploads.ts
tests/              vitest suite + e2e/run.ts
docs/DEPLOYMENT.md  GitHub + Vercel + database + email setup
```

## Security summary
scrypt password hashing · email verification required before student login · opaque server-side sessions
(HttpOnly, SameSite=Lax, Secure in production, only an HMAC stored) · role checks on the server for every
protected page · single admin enforced by the database · DB-backed rate limiting · no secrets in the repo.

## Admin portal (Phase 3)
Log in at `/admin/login` (account created once with `npm run admin:create`). Pages: dashboard (live counts), student records (search, combinable filters, sorting, pagination), receipt review (`/admin/submissions/<id>`), payment schedules (create for all students / one year level / one student; edit; remove an unused installment), notifications. Every page and action calls `requireRole("admin")`; the review services re-check the actor is the active administrator. Review decisions are written in ONE transaction to `payment_submissions`, `payment_reviews` (append-only) and `notifications`; schedule changes are recorded in `admin_audit_events`. See DECISIONS.md D-030 to D-040.

## Notifications, email and reminders (Phase 4)
In-app notifications (student and admin, own records only, read/unread, link to the related payment) are written in the same transaction as the payment change. Emails (admin: new receipt; student: verified / correction requested / rejected; reminders) are queued on the notification, sent after the response with retry/backoff, every attempt recorded, never blocking or failing the payment action. Failed emails show on `/admin/email` with a Retry button. Reminders: 5 days before the due date (configurable, `REMINDER_DAYS_BEFORE`), once per installment and due date; overdue notices are OFF until Miss Jean approves (`OVERDUE_REMINDERS_ENABLED`). Scheduled by one Vercel Cron job (`/api/cron/daily`, needs `CRON_SECRET`). Details: DECISIONS.md D-042 to D-050, docs/DEPLOYMENT.md section 6.

## Testing
`npm test` (148 integration tests on a real PostgreSQL: auth, student, admin, Phase 4 email/reminders/migration upgrade) and `npm run build && npm run test:e2e` (74 browser checks, needs Playwright + Chromium; `NODE_PATH` must resolve `playwright`). Results and gaps: TEST_RESULTS.md.

## Maintenance workflow
Edit code -> `npm run typecheck && npm test` -> schema change: edit `src/db/schema.ts`, `npm run db:generate`, review/hand-edit the SQL (add backfills BEFORE new constraints), commit `drizzle/` -> push to a branch -> Vercel preview -> merge to `main` (production). Apply migrations with `DATABASE_URL=<prod> npm run db:migrate` BEFORE deploying code that needs them. Re-run `npm audit` periodically.

## Receipts (Phase 2)
PNG/JPEG only, 10 MB max, type verified from the file's bytes on the server. Receipts live in a **private** object store
(Vercel Blob in production) and are served only through `GET /api/receipts/<id>` after an ownership check - never a public URL.
Uploads go straight from the browser to storage using a short-lived, server-issued authorization. See `DECISIONS.md` D-012, D-013, D-024.

## Continuity documents
`PROJECT_CONTEXT.md` · `BUILD_PROGRESS.md` · `BUILD_HANDOFF.md` · `DECISIONS.md` · `TEST_RESULTS.md` · `PHASE_HANDOFF_INSTRUCTIONS.md`


## Verified deletion and payment-plan length

An administrator may delete pending or verified submissions from `/admin/submissions/<id>`. For a verified submission, the receipt is removed, the append-only review decision is detached and retained, the audit event is recorded, and the installment remains available for a replacement. Ensure the intended production database has applied `drizzle/0007_verified_submission_deletion.sql`; run `npm run db:migrate` with that database's `DATABASE_URL` configured before using this feature. Vercel builds do not apply migrations automatically. Batch-generated payment plans are limited to 24 monthly installments; the 30-month batch-rollover interval is a separate student-lifecycle rule.


If object storage is temporarily unavailable during a deletion, the submission can still be removed safely: the private receipt key is queued in `orphaned_uploads`, and the existing cleanup job retries the object deletion.
