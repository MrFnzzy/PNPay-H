# PHASE_HANDOFF_INSTRUCTIONS

For a new Claude account or developer maintaining PNPay-H from **PNPay-H_Phase4_Final.zip**. Do not rely on any earlier conversation. All four build phases are done; what remains is deployment, live verification and maintenance.

## Start here
1. Unzip. Read in this order: this file, BUILD_HANDOFF.md, BUILD_PROGRESS.md, PROJECT_CONTEXT.md, DECISIONS.md, TEST_RESULTS.md, README.md, docs/DEPLOYMENT.md. The original LLD is `docs/source/PNPay-H_LLD.docx`.
2. Keep the stack: Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Resend, Vercel Blob. Do not switch to Prisma or rewrite phases.
3. Verify the baseline BEFORE changing anything:
   ```bash
   npm ci && npm run typecheck && npm test && npm run build
   npm run test:e2e        # optional; needs Playwright + Chromium resolvable via NODE_PATH
   ```
   `npm test` starts an embedded PostgreSQL, which refuses to run as root: use a normal OS user, or set `TEST_DATABASE_URL` to a disposable database (the migration-upgrade test also needs CREATE DATABASE rights there). Expected: **143/143** tests, E2E **74/74**.
4. If this ZIP and a GitHub repository disagree, inspect both and record the difference in BUILD_HANDOFF.md. Never overwrite newer work; never force-push.

## Rules that must keep holding
- Student isolation: every student query takes the session user's id; never a URL/body id.
- Installment status is derived (`src/lib/payments/status.ts`, SQL twin in `src/lib/admin/records.ts`), never stored; Pending / Needs Correction / Rejected never count as paid (D-020, D-030).
- Only the active administrator reviews; every admin page/action calls `requireRole("admin")` and services re-check the actor (D-039). Review change + history row + notification happen in ONE transaction; only `pending_review` can be decided (D-031). `payment_reviews` and `admin_audit_events` are append-only (triggers).
- Receipts are private: the ONLY read path is `GET /api/receipts/[submissionId]`. Vercel's filesystem is never used for receipts.
- Email (D-042..D-047): never send inside a payment transaction; the worker only touches notifications/email_deliveries; clear `email_pending` only on success/exhaustion/not-applicable; only status `failed` is retriable; no bodies, tokens, remarks or reference numbers in logs or emails; reminder de-duplication is the unique index `payment_reminders_once`; cron routes are GET-only and fail closed.
- Never commit secrets, `.env*`, receipts or dumps. Never reset a production database. Never claim GitHub/Vercel/Blob/Resend success unless verified.

## What is still to do (needs the user's accounts)
Follow `docs/DEPLOYMENT.md`: GitHub push -> managed PostgreSQL + `npm run db:migrate` (0000-0003) -> Resend -> Vercel project and env vars (incl. `CRON_SECRET`) -> Private Blob store -> `npm run admin:create` -> run the section 8 checklist on the live URL -> record results in TEST_RESULTS.md and correct BUILD_PROGRESS.md status. Open business decisions: OPEN-4, OPEN-9, OPEN-15, D-033 (Miss Jean); OPEN-13, OPEN-14 (client); OPEN-11/12 (names).
Recommended maintenance: migrate to zod 4 (D-050) and re-run `npm audit`; consider a full script-src CSP with nonces; consider a faster email-retry cron on a paid Vercel plan.

## Ready-to-copy maintenance prompt
```
You are maintaining the existing PNPay-H project (Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Vercel, GitHub). Do not rely on any earlier conversation.
I am attaching PNPay-H_Phase4_Final.zip (and the LLD). Unzip it and read PHASE_HANDOFF_INSTRUCTIONS.md first, then BUILD_HANDOFF.md, BUILD_PROGRESS.md, PROJECT_CONTEXT.md, DECISIONS.md, TEST_RESULTS.md, README.md and docs/DEPLOYMENT.md.
Verify the baseline (npm ci, typecheck, npm test as a non-root user, build; expect 143/143) and report any discrepancy before changing anything.
Keep the stack and the rules D-016 to D-050. Do not add features or business rules that I have not requested. My task: <describe the task: e.g. help me deploy to Vercel step by step / fix this bug / apply Miss Jean's reminder decision>.
Update the continuity documents afterwards and, if I ask for a package, create a new complete ZIP, list and extract it to verify it, and report honestly (COMPLETE / PARTIALLY COMPLETE / BLOCKED).
```
