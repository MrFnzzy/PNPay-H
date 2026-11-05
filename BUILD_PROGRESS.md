# BUILD_PROGRESS

Last updated: 2026-11-05 (end of Phase 4 - final package)

## Overall status
| Phase | Name | Status |
|---|---|---|
| 1 | Foundation and Authentication | **COMPLETE** (code, tests, docs, ZIP). Deployment/GitHub sync: **BLOCKED on user action** (no access from build environment). |
| 2 | Student Portal and Receipt Submission | **PARTIALLY COMPLETE** - all student features built and tested locally (67/67 integration, 42/42 browser E2E, production build OK). Not verified: live Vercel Blob storage, GitHub push, Vercel deployment (no access from the build environment). |
| 3 | Admin Portal and Receipt Verification | **PARTIALLY COMPLETE** - every Phase 3 feature built and tested locally (116/116 integration, 64/64 browser E2E, production build OK). Not verified: Vercel deployment, GitHub push, live Blob, migration `0002` on the managed database (no access from the build environment). |
| 4 | Notifications, Integration, Testing, Deployment | **PARTIALLY COMPLETE** - every code deliverable built and tested locally (143/143 integration, 74/74 browser E2E, production build OK). **BLOCKED on the user:** GitHub push, Vercel deployment + cron, live Blob / Resend / managed-database verification (no access from the build environment). |

**Overall project status: PARTIALLY COMPLETE.** Not COMPLETE because the Master Instructions' definition of done requires a deployed, tested Vercel application and a verified GitHub repository.

## Phase 4 — completed
- In-app notifications finished: list, read/unread, mark one/all, correct recipient, link to the related installment/submission, persistence, per-user authorization (tested student<->student and student<->admin). Admin gets "Corrected receipt resubmitted".
- Email delivery worker: claim with lease (`FOR UPDATE SKIP LOCKED`), Resend with Idempotency-Key, every attempt recorded, backoff retry (5 attempts), permanent-error handling, admin retry (one / all, audited), never double-sends, never touches payment data, only verified+active recipients, no remarks/reference/student ID in emails.
- Triggering that suits serverless: `after()` right after each action, daily Vercel Cron safety net, "Send waiting emails now" button.
- Payment reminders: 5-day default window (configurable), excludes paid and awaiting-review, DB-level de-duplication, in-app + queued email in one transaction; overdue notices implemented but OFF pending Miss Jean (OPEN-15).
- Admin troubleshooting page `/admin/email`, dashboard badge, scheduled-job log (`job_runs`).
- Security audit with fixes (CSP baseline, no reflected error text, drizzle-orm 0.45.4); documented accepted dependency risks.
- Migration `0003_phase4_notifications_email` (tested as an upgrade of Phase 3 data). Docs: README, DEPLOYMENT, all six continuity documents. Tests: 27 new integration + 10 new browser checks.

## Phase 4 — incomplete / needs the user
- GitHub push; Vercel project, env vars, Private Blob store, Resend domain/key, managed PostgreSQL + migrations 0000-0003, `admin:create`, enabling cron (all in docs/DEPLOYMENT.md). Production URL: none yet.
- Live verification never done: Vercel Blob privacy, Resend delivery and idempotency, Vercel Cron firing, migration `0002` triggers on the managed database, deployed-site checklist (DEPLOYMENT.md section 8).
- Business confirmations: Miss Jean - real installment count/annual total (OPEN-4), 5-day reminder (OPEN-9), overdue rule (OPEN-15), meaning of "payment month" (D-033). Client - remarks in emails (OPEN-14), admin receipt-view logging (OPEN-13). OPEN-11/12 (domain, repo names).
- Not built by design: admin "deadline approaching" notices, faster email-retry cron (needs a paid Vercel plan), zod 4 migration (D-050), full script-src CSP.

## Phase 3 — completed
- Admin dashboard from real data: total / pending / verified / needs-correction / rejected submissions, student payment records, overdue installments, upcoming deadlines (30 days), recent submission activity, review queue, unread admin notifications. Zero-safe, nothing hardcoded.
- Student record management: search by name / student ID, year level, due month, payment-date range, receipt status (incl. "none"), installment status; sort by student name / submission date / due date; all combinable, parameterized, whitelisted, paginated (25/page), read-only. Per-student record page.
- Payment schedule management: create for all active students / one year level / one student (default ₱500, non-standard amount needs a note), edit with lock rules, remove unused installments, grouped overview, change history; duplicates (case-insensitive) prevented in app and database; verified/Paid installments never silently changed.
- Receipt review: full details, authorized receipt image (admin read path on `/api/receipts/[id]`), history chain with decisions and remarks.
- Verify / Request correction / Reject: one transaction (locks, eligibility, duplicate-transaction checks, status, append-only `payment_reviews` row, student notification with `email_pending`), rollback on any failure, concurrency-safe, invalid transitions refused.
- Audit: `payment_reviews` + `admin_audit_events`, both append-only via triggers.
- Migration `0002_phase3_admin_review`. Tests: 49 new integration + 22 new browser E2E; 1 Phase 2 browser assertion intentionally updated (admin receipt read, D-029).

## Phase 3 — incomplete / needs the user
- Vercel deployment, GitHub push, live Blob check, running migration `0002` on the managed PostgreSQL (the role must be able to create functions/triggers).
- Emails are still only queued (`notifications.email_pending`); no sending, retry, reminders or scheduled jobs (Phase 4).
- Open questions: OPEN-4 (real installment count / annual total - Miss Jean), OPEN-9, OPEN-11, OPEN-12, OPEN-13, OPEN-14. D-033 (what "payment month" means) is worth confirming with Miss Jean.

## Phase 2 — completed
- Student dashboard from the database (total fee, verified paid, remaining, progress %, overdue count, upcoming deadlines, recent transactions, monthly overview), zero-safe.
- Monthly payment tracker (chronological; installment status vs latest receipt status kept separate).
- Payment calendar (read-only; selecting shows period/amount/due date/status).
- Payment history (paginated) and recent transactions with receipt link, remarks, method, reference.
- Receipt submission form (installment, read-only amount, date, method, reference, screenshot) and the full server-side submission pipeline (ownership, eligibility, validation, content check, transaction, notifications, cleanup).
- Private receipt storage layer (Vercel Blob private / local dev / memory tests), intent-based direct upload, owner-only receipt retrieval.
- Student in-app notifications (list, unread badge, mark read / all, links to payment details); event dispatcher ready for Phase 3/4.
- Migration `0001_phase2_student_portal`; scripts `seed:dev`, `cleanup:uploads`.
- Tests: 33 new integration + 21 new browser E2E; Phase 1 tests unchanged and passing.

## Phase 2 — incomplete / needs the user
- Live Vercel Blob verification, GitHub push, Vercel preview/production deployment (see BUILD_HANDOFF.md).
- (Superseded in Phase 3: the administrator now creates installments at `/admin/schedules`; `npm run seed:dev` remains a dev convenience.)
- Student emails and admin emails are not sent yet (Phase 4); `notifications.email_pending` marks what to send.
- Remaining open questions: OPEN-4 (real installment count / annual total), OPEN-9 (reminder timing), OPEN-10, OPEN-11, OPEN-12.

## Phase 1 — completed
- Next.js 15 + TypeScript project, folder structure, env validation (lazy, no secrets needed to build), security headers, health endpoint, base layout and CSS.
- Drizzle schema + migration `0000_init`: `users`, `payment_obligations`, `email_verification_tokens`, `sessions`, `email_deliveries`, `rate_limit_events` (constraints/indexes in PROJECT_CONTEXT.md).
- Student registration (client + server validation, duplicate handling incl. concurrency, role always `student`, unverified until email confirmed).
- Email verification (24 h, one-time, atomic), expired/invalid/used handling, resend with rate limiting, email delivery logging.
- Student login, admin login (separate role checks), logout, DB sessions with regeneration and expiry, `requireRole` guards, middleware redirect.
- Controlled admin setup script (`npm run admin:create`), single-admin database rule.
- Placeholder student and admin dashboards (to prove protected routes).
- Tests: 34 integration + 21 browser E2E, all passing. Production build passes.
- Docs: README, DEPLOYMENT, 6 continuity documents, `.env.example`, CI workflow (`.github/workflows/ci.yml`), `vercel.json`.

## Phase 1 — incomplete / needs the user
- Not pushed to GitHub and not deployed to Vercel (see BUILD_HANDOFF.md → "Actions needed from the user").
- Resend account/domain, production database, and the admin account have not been created.
- Open questions OPEN-1 … OPEN-12 in DECISIONS.md (resolved for Phase 2 in DECISIONS.md D-012..D-029).

## (Historical) Not built after Phase 3 - now built in Phase 4, except where Phase 4 says otherwise
Sending emails (student review emails, admin new-receipt email), email retry job, payment reminders (LLD default 5 days before due) and overdue notices with de-duplication, scheduled jobs (Vercel Cron) for email retry / reminders / `cleanup:uploads`, full-integration test pass on a deployed preview, GitHub sync, Vercel deployment and live verification, final package `PNPay-H_Phase4_Final.zip`.

## Next phase
Phase 4 — Notifications, Full Integration, Testing, Deployment. Start from `PHASE_HANDOFF_INSTRUCTIONS.md` (it contains the exact starting task and a ready-to-copy prompt). Do not start until the user confirms.
