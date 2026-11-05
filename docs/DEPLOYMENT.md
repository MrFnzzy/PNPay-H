# Deployment: GitHub + Vercel + PostgreSQL + Blob + Email + Cron

Status: **prepared, NOT deployed.** The build environments used for Phases 1-4 had no GitHub, Vercel, Neon, Resend or Blob access.
Nothing below has been run against live services. Do the steps in order, then run the checklist in section 8 and record the result in TEST_RESULTS.md.

## 1. GitHub
```bash
cd PNPay-H                       # extracted from PNPay-H_Phase4_Final.zip (the ZIP has no .git history)
git init -b main && git add -A && git commit -m "PNPay-H Phase 4 (complete project)"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main          # if the repository already has commits, DO NOT force-push: fetch, compare, merge
```
If a repository already exists from an earlier phase, inspect both and keep the newer work. `.env*` (except `.env.example`) is git-ignored; never commit receipts, dumps or credentials.
CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every push / pull request.

## 2. Database (managed PostgreSQL)
Create a database (Neon via the Vercel Marketplace is simplest; Supabase also works) in a region near Vercel's `sin1`. Put its URL in `DATABASE_URL`
(use the direct, non-pooled URL for migrations if your provider offers a pooler).
```bash
DATABASE_URL="<production url>" npm run db:migrate    # applies 0000 -> 0003, in order, safely on existing data
```
Migrations: `0000_init`, `0001_phase2_student_portal`, `0002_phase3_admin_review` (creates a function + 2 append-only triggers: the role must be allowed to create them),
`0003_phase4_notifications_email` (adds email-queue columns, `payment_reminders`, `job_runs`; backfills rows queued by earlier phases before adding a check constraint).
`0003` was tested as an upgrade of a database that already held Phase 3 data (tests/phase4.test.ts). **Never reset a production database.** Back it up (provider snapshot) before migrating.

## 3. Email - choose ONE provider (production refuses `file`/`memory`)
**Option A - free SMTP with Nodemailer (e.g. Gmail), `EMAIL_PROVIDER=smtp`.** No domain needed.
1. Use a dedicated Gmail account. Turn on 2-Step Verification, then create an **App password** (Google Account -> Security -> App passwords). Your normal password will NOT work.
2. Set `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<the gmail address>`, `SMTP_PASS=<the 16-character app password>`, `EMAIL_FROM="PNPay-H <the same gmail address>"` (Gmail rewrites other sender addresses).
3. Limits: a free Gmail account allows roughly 500 messages per day, and mail may land in spam; fine for a school class, not for large volumes. Port 587 works too (`SMTP_PORT=587`, `SMTP_SECURE=false`).
4. SMTP has no idempotency key: if a server crashes in the instant after Gmail accepted a message but before our database update, one duplicate email is possible (rare). Resend avoids that.
**Option B - Resend, `EMAIL_PROVIDER=resend`.** Verify a sending domain, create an API key, set `RESEND_API_KEY` and `EMAIL_FROM` (an address on that domain). Every email carries an `Idempotency-Key` header; its behaviour has not been tested against the live API.
Neither live provider has been tested here; the SMTP path was tested against an in-process fake SMTP server with the real Nodemailer transport.

## 4. Vercel project
Import the GitHub repo (Framework Next.js; install `npm ci`; build `npm run build`; production branch `main`). Add for **Production** and **Preview** (use a separate database for Preview):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | managed Postgres |
| `AUTH_SECRET` | `openssl rand -base64 48`. Changing it logs everyone out and invalidates pending verification links |
| `APP_BASE_URL` | production URL, `https://...`, no trailing slash (used in every email link) |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | `smtp` or `resend` (section 3) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | only for `smtp` (Gmail: `smtp.gmail.com`, `465`, `true`, address, app password) |
| `RESEND_API_KEY` | only for `resend` |
| `RECEIPT_STORAGE` | `vercel-blob` (production refuses anything else) |
| `BLOB_READ_WRITE_TOKEN` | added when a **Private** Blob store is connected (step 5) |
| `CRON_SECRET` | `openssl rand -base64 48` (>= 32 chars). Vercel then sends it to the cron routes automatically |
| `REMINDER_DAYS_BEFORE` | optional, default 5 (LLD default; confirm with Miss Jean, OPEN-9) |
| `OVERDUE_REMINDERS_ENABLED` | optional, default `0`. Set `1` only after Miss Jean approves overdue notices (OPEN-15) |
| `RECEIPT_MAX_BYTES` | optional, default 10485760 |

**Never set `ALLOW_NON_PRODUCTION_STORAGE` on Vercel.** A `CRON_SECRET` shorter than 32 characters makes the app refuse to start (configuration error).

## 5. Private receipt storage (Vercel Blob)
Vercel project -> Storage -> Create -> Blob -> **Private** -> connect to the project (adds `BLOB_READ_WRITE_TOKEN`), then redeploy.
Verify once live: submit a test receipt, open it from History, and confirm the blob's own URL is not reachable without the token. **Never exercised against a real Blob store so far.**

## 6. Scheduled jobs (Vercel Cron)
`vercel.json` contains ONE cron: `GET /api/cron/daily` at `0 1 * * *` UTC (09:00 Manila). It runs, in order and independently: payment reminders -> email delivery/retry -> receipt-upload cleanup.
That schedule is valid on every plan, including Hobby (Hobby allows cron only once per day; a more frequent schedule makes the deployment fail there).
- Emails are ALSO sent right after each action (Next.js `after`), so the daily job is mainly the safety net and the reminder trigger.
- Failed emails are retried with backoff (1, 5, 30, 120 minutes; 5 attempts) whenever the worker runs: on the next student/admin action, the "Send waiting emails now" button, or the cron job. **On Hobby, an automatic retry can therefore wait until the next action or the next day.**
- On a plan that allows it, add a frequent job for faster retries: `{ "path": "/api/cron/email", "schedule": "*/10 * * * *" }` to `crons` in `vercel.json`.
- Other routes: `/api/cron/reminders`, `/api/cron/cleanup`. All require `Authorization: Bearer $CRON_SECRET`, accept GET only, and answer 503 if `CRON_SECRET` is missing.
- `/admin/email` (administrator) shows failed / retrying / waiting emails with a Retry button and the last run of each job; "No scheduled job has run yet" means cron is not firing.

## 7. Create the administrator (once)
```bash
DATABASE_URL="<production url>" AUTH_SECRET="<same as Vercel>" APP_BASE_URL="https://<prod>" \
ADMIN_FULL_NAME="Miss Jean" ADMIN_EMAIL="<her email>" ADMIN_PASSWORD="<strong password>" npm run admin:create
```
(`-- --reset-password` later changes it.) The admin email address receives "new receipt" emails, so it must be a real inbox.

## 8. Post-deployment checklist (do NOT mark the deployment done until each item passed on the live URL)
1. `/api/health` returns `{"status":"ok"}`; landing page loads.
2. Register a test student with a real inbox -> verification email arrives -> verify -> log in -> dashboard.
3. Admin creates an installment (`/admin/schedules`); student sees it in the tracker.
4. Student uploads a receipt (PNG/JPEG) -> status Pending Review; Miss Jean gets the in-app notification AND an email.
5. Receipt opens only through `/api/receipts/<id>` (student: own; admin: any); a second student cannot open it; the Blob URL is not public.
6. Admin verifies / requests correction / rejects -> student notification + email; dashboard recalculates; History is correct; resubmission works.
7. `/admin/email`: no failed emails; after the first cron run (trigger it from Vercel -> Settings -> Cron Jobs -> Run) the job log shows runs.
8. Reminder: create an installment due within 5 days -> after the cron run the student has a "Payment due soon" notification + email (once).
9. Log out of both portals; redeploy and confirm the data is still there.
