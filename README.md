# PNPay-H — Student Payment Verification System

Students pay through GCash (or another payment app) and submit a screenshot of their receipt here.
The administrator (Miss Jean) reviews each receipt and verifies, rejects, or asks for a correction.
**The site never processes payments.**

## Features

**Students**
- Register, verify their email address, and log in
- Dashboard with fee total, verified amount paid, balance, progress, and overdue count
- Monthly payment tracker and payment calendar
- Receipt submission (installment, date, method, optional reference number, PNG/JPEG screenshot)
- Payment history with the administrator's remarks, and in-app notifications

**Administrator**
- Dashboard with live submission counts, pending reviews, overdue installments, and recent activity
- Student records with search, filters, and sorting
- Payment schedule management (default ₱500 installments, duplicate prevention)
- Receipt review: verify, request correction, or reject, with remarks and a full review history
- Notifications and email delivery monitoring (`/admin/email`)

**Automatic**
- In-app and email notifications with retry for failed emails
- Payment reminders five days before the due date (configurable), sent once per installment
- Scheduled daily job for reminders, email retry, and cleanup of unused uploads

## Stack

Next.js 15 (App Router) · TypeScript · Drizzle ORM + `pg` · PostgreSQL · email via Nodemailer SMTP (e.g. Gmail) or Resend · Vercel

## Quick start (local)

Requirements: Node 20.12+ and a PostgreSQL database (local or managed, e.g. Neon).

```bash
npm ci
cp .env.example .env.local       # fill in real values (never commit it)
npm run db:migrate               # applies the migrations in ./drizzle
npm run admin:create             # one-time administrator setup (reads ADMIN_* from .env.local)
npm run dev                      # http://localhost:3000
```

With `EMAIL_PROVIDER=file`, verification emails are written to `.dev-mail/` instead of being sent.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Development server / production build / serve the build |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and integration tests (starts a throwaway embedded PostgreSQL; needs a non-root OS user) |
| `npm run build && npm run test:e2e` | Browser end-to-end tests against the production build (needs Playwright + Chromium) |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run admin:create [-- --reset-password]` | Create (or reset the password of) the single administrator |
| `npm run seed:dev -- --email <student> --amount 500 --months 10 --start 2026-08-15` | Development only: create test installments for a student (refuses to run in production) |
| `npm run cleanup:uploads` | Delete receipt uploads that were never submitted and retry failed deletions (also runs daily) |

Set `TEST_DATABASE_URL` to run `npm test` against a disposable database instead of the embedded one.

## Project structure

```
src/app/            pages and routes (student, admin, login, register, verify-email, api/cron, api/health, api/receipts)
src/app/actions/    server actions (form handlers)
src/components/     reusable UI
src/db/             Drizzle schema and database connection
src/lib/            env validation, validation schemas, rate limiting, auth, errors
src/lib/payments/   installment status rules, queries, receipt submission, notification events, reminders
src/lib/admin/      schedules, records, receipt review
src/lib/email/      email providers, templates, delivery queue
src/lib/storage/    private receipt storage (vercel-blob, postgres, local, memory)
src/middleware.ts   redirects requests that have no session cookie
drizzle/            SQL migrations
scripts/            migrate, create-admin, seed-dev-schedule, cleanup-uploads
tests/              vitest suite and e2e/run.ts
docs/               DEPLOYMENT.md and the low-level design document
```

## Security summary

- Passwords hashed with scrypt; email verification required before a student can log in
- Opaque server-side sessions (HttpOnly, SameSite=Lax, Secure in production)
- Role checks on the server for every protected page and action; students can only see their own records and receipts
- Single administrator enforced by the database; no public admin sign-up
- Server-side validation and parameterized queries; database-backed rate limiting
- Receipts: PNG/JPEG only, 10 MB maximum, file type checked from the file's bytes, stored privately and served only after an ownership check
- Review decisions are saved in one database transaction and recorded in an append-only history
- No secrets in the repository

## Maintenance workflow

1. Edit the code, then run `npm run typecheck && npm test`.
2. For a schema change: edit `src/db/schema.ts`, run `npm run db:generate`, review the SQL, and commit `drizzle/`.
3. Push to a branch, check the Vercel preview, then merge to `main`.
4. Apply migrations with `DATABASE_URL=<production url> npm run db:migrate` **before** deploying code that needs them. Vercel builds do not run migrations.
5. Run `npm audit` periodically.

Deleting a verified payment needs migration `0007_verified_submission_deletion.sql`. If object storage is unavailable during a deletion, the receipt key is queued in `orphaned_uploads` and the cleanup job retries it. Generated payment plans are limited to 24 monthly installments.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for GitHub, Vercel, database, email, storage, and scheduled-job setup.
