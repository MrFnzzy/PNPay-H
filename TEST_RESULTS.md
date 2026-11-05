# TEST_RESULTS — Phases 1-4 (the PHASE 4 section is first; older sections follow unchanged)

# PHASE 4 RESULTS (2026-11-05)
Environment: Linux sandbox, Node 22.23, Next.js 15.5.29, PostgreSQL 18 (embedded, throwaway), Chromium via Playwright, mock Resend HTTP server. No GitHub, Vercel, Neon, Blob or live Resend access.
Labels: **PASSED** = executed and passed here. **FAILED** = executed and failed. **BLOCKED** = needs an account/credential not available here. **NOT TESTED** = not executed.

## Summary
| Suite | Command | Result |
|---|---|---|
| Baseline BEFORE any Phase 4 change | `npm ci; typecheck; npm test; npm run build; npm run test:e2e` | PASSED: 116/116, build OK (25 routes), E2E 64/64 (matches the Phase 3 documents) |
| Typecheck | `npm run typecheck` | PASSED, 0 errors |
| Integration (real PostgreSQL) | `npm test` | **PASSED 148/148** (116 earlier + 27 new in `tests/phase4.test.ts`) |
| Production build | `npm run build` | PASSED (30 routes incl. `/admin/email`, 4 cron routes) |
| Browser E2E on the production build | `npm run test:e2e` | **PASSED 74/74** (64 earlier + 10 new "P4" checks) |
| Package check | extract the final ZIP, `npm ci`, typecheck, test, build | see "Final package verification" below |
| Deployed application (Vercel) | - | **BLOCKED / NOT TESTED** (no access) |

## Defects found and fixed in Phase 4 (before/while building)
| # | Finding | Fix |
|---|---|---|
| 1 | Generated migration added a CHECK constraint after adding columns: it would FAIL on any production database that already has rows with `email_pending=true` (Phases 2-3 create them). | Hand-written backfill placed before the constraint; proven by the upgrade test (tests/phase4.test.ts, "Migration 0003 upgrades ..."). |
| 2 | Phase 1-3 never sent notification emails; only `email_pending` rows existed. | Worker, retry, admin visibility (Phase 4). |
| 3 | Admin page would have reflected arbitrary `?error=` text (content spoofing). | Fixed error codes mapped server-side; E2E check "error query parameter cannot inject text". |
| 4 | No CSP / framing / form-action / base-uri protection. | Baseline CSP directives (D-049); E2E check. |
| 5 | `drizzle-orm` 0.44.7 had a high advisory (fix non-breaking). | Upgraded to 0.45.4; typecheck, 143 tests, 74 E2E pass; `drizzle-kit generate` reports no drift. |
| 6 | Mutation check: removing the claim lease/SKIP LOCKED made the concurrency test send 31 emails instead of 4 - proves the test detects a broken worker (code restored). | - |
Two Phase 2 E2E assertions assumed emails are never sent ("email queued, not sent"); updated to "queued or already sent" because emails are now delivered.

## Phase 4 acceptance matrix (prompt Steps 2-9)
| Requirement | Result | Evidence |
|---|---|---|
| New-receipt notification for Miss Jean (in-app + email) | PASSED | phase4 test 1; E2E P4 admin email (review link, no reference number) |
| Receipt verified / correction requested / rejected: student in-app + email, correct recipient, no remarks in email | PASSED | phase4 "verified, correction-requested and rejected ..."; E2E P4 |
| Corrected receipt resubmitted -> admin notified with own title | PASSED | phase4 |
| Notification list, read/unread, mark read, mark all, related-payment link, DB persistence | PASSED | phase4 authorization test; Phase 2/3 tests; E2E reminder link + anchor |
| Each user sees/changes only their own notifications (student<->student, student<->admin) | PASSED | phase4 "each user can only list, count and mark their OWN" |
| Email only to active accounts with verified address | PASSED | phase4 "never emails an unverified or deactivated recipient"; reminder tests |
| Delivery: record event, send, record attempt, record success/failure | PASSED | phase4 tests 1,4; `email_deliveries` rows per attempt |
| Failed delivery retried (backoff; max attempts; permanent errors; admin retry) | PASSED (mock/memory provider) | phase4 retry tests; E2E outage + Retry button. **Live Resend: NOT TESTED** |
| No duplicate emails (sequential, concurrent, crashed worker, sent rows) | PASSED | phase4 concurrency (8 workers, 4 emails -> 4), lease test, "second run sends nothing"; E2E "exactly once" |
| Retry never creates submissions/reviews; payment workflow survives email failure | PASSED | phase4 "provider failure is recorded, the payment workflow is unaffected" (counts unchanged) |
| Failed emails visible to the administrator | PASSED | phase4 overview test; E2E `/admin/email` + dashboard badge |
| Reminder 5 days before due; excludes paid / pending; dedup; in-app + email + record | PASSED | phase4 reminder tests (window, exclusions, sequential + 6 concurrent runs, DB unique index, rescheduled due date, inactive/unverified/admin excluded, env override) |
| Overdue reminders follow approved rules | PASSED as implemented (OFF by default, one notice when enabled); **the approved rule itself is unknown (OPEN-15)** |
| Cron routes: secret required, GET only, fail closed, job log | PASSED | phase4 `authorizeCron`; E2E P4 (401/405/200) |
| Scheduled execution on real Vercel Cron | **BLOCKED** | no Vercel access |

## Security audit (Step 7) - what was actually reviewed
| Area | Finding | Status |
|---|---|---|
| Authentication / passwords | scrypt N=32768; email verified before login; generic login errors; rate limits (login 5/15 min per email, 20 per IP; resend; register). | PASSED (Phase 1 tests re-run) |
| Session management | opaque 256-bit token, only HMAC stored, HttpOnly + SameSite=Lax + Secure(prod), regenerated at login, deleted at logout, TTL 7 d / 8 h; replayed cookie rejected. | PASSED (integration + E2E) |
| Authorization / isolation | `requireRole` on every page/action; services re-check the admin; student queries filtered by session id; receipts only via `/api/receipts/[id]`; E2E cross-student/unauthenticated 401/404. | PASSED |
| CSRF | Next.js server actions check Origin vs Host; JSON/PUT routes use `sameOrigin` + SameSite=Lax; cron routes need a bearer secret. Cross-origin intent refused (E2E). | PASSED (no separate token needed) |
| Input / file validation | zod server-side; PNG/JPEG decided from bytes, size cap, sha256; non-image disguised as PNG rejected. | PASSED (synthetic images only) |
| SQL injection | Drizzle parameters; raw SQL only with bound params (`sql` template); sort columns whitelisted; LIKE wildcards escaped; new cron/queue SQL uses bound params only. | PASSED (review + Phase 3 tests) |
| XSS | no `dangerouslySetInnerHTML`; React escaping; email templates HTML-escape every dynamic value; `?error=` no longer reflected. | PASSED (review) |
| Duplicate submissions / transactions | partial unique indexes + review-time re-checks; concurrency tests. | PASSED |
| Rate limiting | auth endpoints and upload intents limited. **Not rate-limited:** receipt GET, admin actions, cron (secret-protected). | ACCEPTED (authenticated, low-risk) |
| Secrets | `.env*` ignored; scan of a simulated commit: 123 tracked files, no forbidden file names, no secret patterns; CRON_SECRET/bodies/remarks absent from server log (E2E). | PASSED |
| Error handling / logging | `toSafeMessage`; only error names/codes logged; email failures log type + HTTP status only. | PASSED |
| DB transaction safety | review, submit, reminder creation each in one transaction with consistent lock order (installment first); rollback tests from Phase 3. | PASSED |
| Dependencies | `npm audit --omit=dev`: 7 findings before, drizzle fixed; remaining zod / next(postcss) / @vercel transitive are not reachable from user input (D-050). | ACCEPTED, documented |
| Security headers | X-Frame-Options, nosniff, HSTS, Referrer-Policy, Permissions-Policy, baseline CSP. Full script-src CSP not set. | PARTIAL (D-049) |
| Penetration test / third-party review | - | NOT TESTED |

## Database and storage audit (Step 8)
| Check | Result |
|---|---|
| All migrations present (0000-0003), journal consistent, `drizzle-kit generate` reports no drift | PASSED |
| Fresh database migrates (every test run) | PASSED |
| Upgrade of a database with Phase 3 data (backfill + constraint) | PASSED (embedded PostgreSQL 18) |
| Foreign keys valid; obligation uniqueness; reminder uniqueness; review history append-only | PASSED |
| Migration on managed PostgreSQL (Neon/Supabase): triggers/functions permission | **BLOCKED** (no database) |
| Receipt storage persists across redeploys; Blob really private | **BLOCKED** (no Blob store). Local/memory providers only |
| Production database never reset by any step | PASSED (none exists) |

## Step 6 workflow (20 steps) and Step 9 minimum list
Steps 1-20 are exercised by the browser E2E on the production build with a real PostgreSQL and mock provider (register, verify, login, dashboard, tracker, select installment, submit PNG, private storage, Pending Review, admin notification + email, admin login, review, decision saved, derived installment status, student notification + email, dashboard recalculation, history), plus correction and rejection resubmission. Step 7 ("pays externally") is outside the system. Not exercised: real GCash screenshots, real mailboxes.
PASSED: registration and duplicate protection; verification and expiry; student/admin login; role restrictions; dashboard isolation; receipt upload; file size/type validation; installment ownership; duplicate transaction prevention; search/filter; schedule management; verification; correction; rejection; reminders; email retry; receipt privacy (local); database rollback; production build (local).
BLOCKED: everything that needs GitHub, Vercel, Neon, Blob or Resend accounts (deployment tests listed in docs/DEPLOYMENT.md section 8).
NOT TESTED: mobile viewport / screen reader / keyboard-only; load; real decodable screenshots; penetration test.

## Addendum: SMTP provider (D-051)
`tests/smtp.test.ts` (5 tests, PASSED): real Nodemailer transport against an in-process fake SMTP server - authenticated delivery, 5xx permanent / 4xx retryable / bad credentials permanent, unreachable server retryable, error text free of addresses and secrets, environment validation (smtp needs host/user/pass; production accepts resend or smtp, refuses file/memory). **Live Gmail: NOT TESTED.** Totals after this addendum: integration 148/148; build and browser E2E re-run (see below).

## Final package verification
Performed 2026-11-05 on the packaged `PNPay-H_Phase4_Final.zip`: extracted into a clean directory and, from there, `npm ci` (148 packages) -> `npm run typecheck` (0 errors) -> `npm test` **148/148** -> `npm run build` OK -> `npm run test:e2e` **74/74**. Archive integrity (`unzip -t`), file listing, forbidden-entry check (no node_modules, .next, .env files other than `.env.example`, receipts, dumps, tsbuildinfo), secret-pattern scan of the extracted tree, and a file-by-file comparison with the working tree were also run (results in the end-of-phase report). The ZIP was rebuilt once after this paragraph was added (documentation text only; no code changed after the verified run).



Run date: 2026-11-04. Environment: Linux sandbox, Node 22.23, Next.js 15.5.29, PostgreSQL 18 (embedded-postgres, throwaway), Chromium via Playwright.
All results below were actually executed in this session; nothing is claimed that was not run.

## Summary
| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Integration (real PostgreSQL) | `npm test` | **34 / 34 passed** (1 file) |
| Production build | `npm run build` (run with `DATABASE_URL` and `AUTH_SECRET` unset) | **succeeded**; 10 routes + middleware |
| Browser E2E against the production build | `npm run build && npm run test:e2e` | **21 / 21 passed** |
| Deployed application | — | **NOT TESTED** (not deployed; see BUILD_HANDOFF.md) |

## Phase 1 acceptance checklist (from the Phase 1 prompt)
| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Valid student registration succeeds | PASS | integration test 1; E2E "valid registration…" |
| 2 | Duplicate email rejected | PASS | integration 2; E2E duplicate registration |
| 3 | Duplicate student ID rejected | PASS | integration 3, 3b (5 concurrent requests → exactly 1 account) |
| 4 | Registration always creates role student | PASS | integration 4+5 |
| 5 | Student cannot select admin role | PASS | submitted `role=admin` is stripped by the schema; DB result role=student |
| 6 | Password stored as secure hash | PASS | integration 6 (scrypt, unique salts, no plaintext) |
| 7 | Verification email generated/queued | PASS | integration 7 (memory outbox, `email_deliveries` row, token hash only); E2E (mock Resend received 1 email) |
| 8 | Valid verification token works | PASS | integration 8; E2E |
| 9 | Expired token fails | PASS | integration 9 |
| 10 | Used token cannot be reused | PASS | integration 10, 10b (4 concurrent → exactly 1 success); E2E |
| 11 | Unverified student cannot log in | PASS | integration 11 (no session row created); E2E |
| 12 | Verified student can log in | PASS | integration 12; E2E (HttpOnly + SameSite=Lax cookie observed) |
| 13 | Invalid credentials rejected | PASS | integration 13; E2E |
| 14 | Student cannot access admin routes | PASS | integration 14; E2E (student redirected from `/admin/dashboard` to `/student/dashboard`; student credentials rejected on admin login) |
| 15 | Admin can log in via controlled setup | PASS | integration 15; E2E uses the real `scripts/create-admin.ts` |
| 16 | Logout invalidates the session | PASS | integration 16; E2E replays the pre-logout cookie and is rejected |
| 17 | Production build succeeds | PASS | `npm run build` |

## Additional security / robustness tests (all PASS)
Resend rate limit (3/h/email) · resend does not reveal unknown emails · resend invalidates previous token · tampered/garbage/oversized tokens rejected ·
login rate limit (5 failures → locked even with correct password) · deactivated user cannot log in and an existing session stops working ·
session expiry · session regeneration (old token dies at login) · only session-token HMAC stored · forged token rejected ·
session for an unverified student rejected · DB rejects a second admin, a student without student ID, a zero amount, a duplicate (student, year, period) obligation, and an obligation with a non-existent student (FK) ·
admin password reset revokes sessions · weak admin password rejected · email provider failure is recorded (`failed`, attempts=1) and the account is kept ·
E2E: unauthenticated access to both portals redirects to the right login · client-side password-mismatch check · opening the verification link does not consume the token (POST needed) ·
security headers (X-Frame-Options, nosniff) present, `X-Powered-By` removed · server output does not contain the raw verification token · `/api/health` leaks nothing.

## Full list of integration tests (verbatim run output)
```
Registration > 1. valid student registration succeeds
Registration > 2. duplicate email is rejected
Registration > 3. duplicate student ID is rejected
Registration > 3b. simultaneous registrations create only one account
Registration > 4+5. role is always student; a submitted role=admin is ignored
Registration > 6. password is stored as a salted scrypt hash, never plaintext
Registration > validation: weak password, mismatch, bad email, missing fields
Registration > 7. verification email is generated and recorded; raw token is not stored
Registration > email failure keeps the account, records the failure and allows resend
Email verification > 8. valid token verifies the email
Email verification > 9. expired token fails
Email verification > 10. used token cannot be reused
Email verification > 10b. concurrent use of one token succeeds exactly once
Email verification > invalid / garbage / tampered tokens are rejected
Email verification > resend issues a new token, invalidates the old one, and does not reveal unknown emails
Email verification > resend is rate limited per email
Email verification > resend does nothing for an already verified student
Login > 11. unverified student cannot log in (and no session is created)
Login > unverified status is not revealed with a wrong password
Login > 12. verified student can log in and gets a working session
Login > 13. invalid credentials are rejected with one generic reason
Login > login is rate limited after repeated failures, even with the right password afterwards
Login > deactivated students cannot log in or use an existing session
Admin and role separation > 15. admin can log in after controlled setup, via the admin portal only
Admin and role separation > 14. a student cannot authenticate to the admin portal and a student session never has the admin role
Admin and role separation > role escalation: the database rejects a second admin and an unverified-style admin shortcut
Admin and role separation > admin setup supports password reset, invalidating old sessions
Admin and role separation > admin setup rejects weak passwords
Sessions > 16. logout invalidates the session
Sessions > sessions expire
Sessions > login regenerates the session: the old token dies and a new one is issued
Sessions > only a hash of the session token is stored; forged tokens fail
Sessions > a session for a student who is not verified is rejected
Schema > payment_obligations: FK, unique student+period, positive amount
 Test Files  1 passed (1)
      Tests  34 passed (34)
```

## Failures encountered and fixed during development
| Problem | Fix |
|---|---|
| `prisma migrate diff` → 403 downloading engines | Switched to Drizzle (D-001) |
| `npm run build` type error: `process.env.NODE_ENV` read-only in `tests/helpers/global-setup.ts` | Removed the assignment (vitest sets it) |
| E2E script type errors (`ProcessEnv`, `playwright` types) | Typed env/spawn explicitly; `playwright` loaded via `createRequire` |

## Known gaps / not tested
- **Not deployed**: no GitHub or Vercel access from the build environment. Vercel runtime, Resend delivery to a real inbox, and a managed Postgres provider were **not** exercised (the E2E used a mock Resend endpoint and a local PostgreSQL).
- Cross-browser / mobile viewport rendering not tested; accessibility only reviewed by markup (labels, aria-invalid, role=alert).
- No load test of the rate limiter under many concurrent IPs.
- `npm audit` was not reviewed.
- The E2E script depends on a Playwright installation outside the project (provided by this sandbox); on another machine install `playwright` and Chromium (`npx playwright install chromium`) and run with it resolvable via `NODE_PATH`, or add it as a devDependency.


---
# Phase 2 test results (run 2026-11-04, build sandbox)

## Commands run and actual results
| Command | Result |
|---|---|
| `npm ci` | OK |
| `npm run typecheck` | 0 errors |
| `npm test` | **67/67 passed** (34 Phase 1 `tests/auth.test.ts` + 33 Phase 2 `tests/student.test.ts`) on a real embedded PostgreSQL |
| `npm run build` | OK, all 19 routes + middleware |
| `npm run build && npm run test:e2e` | **42/42 passed** (21 Phase 1 browser checks + 21 Phase 2) against the production build, real Chromium, real PostgreSQL, local receipt folder |

## Phase 2 coverage (Master step 10 -> test)
- Another student's dashboard / history: `Student data isolation` (integration) + E2E "another student sees only their own data".
- Another student's receipt: `getOwnedReceipt` returns null for non-owner (integration); E2E: owner 200 with `no-store` + `nosniff`, other student 404, unauthenticated 401, admin session 401.
- Amount cannot be modified: client-sent `amount/amountDue/amountSubmitted` ignored, stored amount = installment amount; UI amount field is read-only and has no `name`.
- Cannot submit for another student's installment: `not_found` on intent; a foreign intent/obligation combination is refused (`intent_invalid`); E2E API returns 404.
- Cannot modify status / student id / role: forged `status=verified`, `studentId`, `role` ignored.
- Verified or pending installment: intent refused (`not_eligible`); a pre-issued intent is also refused at submit time and its file removed.
- Invalid types (GIF, PDF-like, EXE-like, HTML, truncated PNG/JPEG, empty): rejected from file content; file deleted. E2E: HTML disguised as `.png`/`image/png` rejected by the server.
- Oversized: rejected (`RECEIPT_MAX_BYTES` lowered in the test), file deleted; E2E: 11 MB blocked in the browser.
- Upload failure: object missing -> `upload_missing`; storage read outage -> `storage_unavailable`, nothing saved, retry works.
- Database failure: real failure injected by renaming the `notifications` table mid-transaction -> `save_failed`, full rollback (no submission), file deleted, intent unusable. With a simultaneous storage-delete failure: file recorded in `orphaned_uploads`, then removed by `cleanupUploads`.
- Duplicates: same reference (any formatting, same or other student) and byte-identical image blocked; reusable after the earlier submission is Rejected. Concurrent double submit -> exactly one submission, the other file cleaned.
- Pending / needs-correction / rejected never counted as paid; only verified; progress = verified / total; zero obligations safe; totals computed from DB with arbitrary amounts and counts.
- Replacement chain: `previous_submission_id` links 3 submissions; history keeps all.
- Notifications: student + admin created in the transaction (admin one `email_pending`), no-admin case succeeds, mark one / all read, scoped to owner.
- Calendar: selecting an item shows details and changes no data (E2E verifies submission and verified counts unchanged).
- Phase 1 regression: all 34 + 21 Phase 1 tests still pass unchanged (registration, email verification, student/admin login, logout/session replay, protected routes, headers).

## Failures encountered during the build (all fixed)
1. First Phase 2 integration run: 1 failure, a wrong expected total in my own test (125150 vs 125100). Test data corrected; code was right.
2. TypeScript: `MemoryStorage.put` lacked the content-type parameter. Fixed.
3. First Phase 2 E2E run: 13 failures. Cause: the test clicked `button[type=submit]`, which matched the top-bar "Log out" button on student pages, logging the user out and cascading. Fixed by giving the receipt form button `id="submitReceipt"`. The application was not at fault.
4. `next build` type-checks the E2E file; an implicit-any in it failed the build once. Fixed.

## NOT tested / known gaps (be honest)
- **Vercel Blob was never contacted.** `src/lib/storage/vercel-blob.ts`, `/api/receipts/blob-token` and the browser `upload()` path are written against the installed `@vercel/blob@2.8.2` types and compile, but there is no token or network access here. Must be verified on a Vercel preview with a real private store (see BUILD_HANDOFF.md "Actions needed").
- No GitHub push and no Vercel deployment/preview was attempted or verified.
- Email is still the Phase 1 mock path; admin/student payment emails are not sent (queued via `email_pending` only).
- Direct-to-Blob uploads cannot be checked for exact size by the browser flow beyond the token's `maximumSizeInBytes`; the server re-checks size and content before saving.
- No test with a real phone screenshot or very large real images; images are synthetic PNG/JPEG headers + random bytes (server validates signatures, not full decodability).
- Calendar rendering checked in desktop Chromium only; no mobile viewport or screen-reader test.
- `cleanup:uploads` is manual; no scheduler until Phase 4.
- `npm audit` not reviewed.


---
# Phase 3 test results (run 2026-11-05, build sandbox)

## Baseline BEFORE any change (verified first, as instructed)
`npm ci` OK · `npm run typecheck` 0 errors · `npm test` **67/67** · `npm run build` OK (19 routes) · `npm run test:e2e` **42/42**. Documentation matched the code; three small doc discrepancies were found and fixed (BUILD_PROGRESS "Next phase" text, PROJECT_CONTEXT header, and the LLD copy that does exist in `docs/source/`).

## Commands run after Phase 3 and actual results
| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` (real embedded PostgreSQL, run as a non-root user) | **116 / 116 passed** (34 `auth.test.ts` + 33 `student.test.ts` + **49 new `admin.test.ts`**) |
| `npm run build` | OK - 25 routes + middleware (6 new admin pages: notifications, records, schedules, schedules/[id], students/[id], submissions/[id]) |
| `npm run build && npm run test:e2e` (production build, real Chromium, real PostgreSQL, local receipt folder) | **64 / 64 passed** (42 Phase 1-2 + 22 new Phase 3) |
| Deployed application (Vercel) | **NOT TESTED** - no Vercel/GitHub access from the build environment |

## Phase 3 checklist (prompt STEP 9) -> evidence
| # | Requirement | Result | Evidence (integration test unless marked E2E) |
|---|---|---|---|
| 1 | Admin dashboard uses actual data | PASS | "1. shows zeros on an empty database", "1. every number comes from real records and follows changes" (counts move after a verification), "1. unread admin notifications..."; E2E "dashboard shows real counts" and "counts follow the new data" |
| 2 | Unauthorized users cannot open admin routes | PASS | service layer: student / random id / deactivated admin all `forbidden`, nothing changed; E2E: unauthenticated -> 3xx to `/admin/login` for all 7 admin pages; logged-in student bounced to `/student/dashboard` from all 7 |
| 3 | Search by student name | PASS | "3. search by student name (partial, case-insensitive)" |
| 4 | Search by student ID | PASS | "4. search by student ID"; E2E search |
| 5 | Combined filters | PASS | "5. combined filters: pending receipts from first-year students for October (the LLD example)" + narrowing cases; E2E combined filters |
| 6 | Sorting | PASS | "6. sorting by student name, submission date and due date (both directions)"; E2E column sort |
| 7 | Empty results display correctly | PASS | "7. empty results..."; E2E "No records match these filters." |
| 8 | Schedule creation works | PASS | "8. creates ... all active students only", "8. can target one year level or one student", "8. validates ..." (15 invalid inputs); E2E UI creation |
| 9 | Schedule editing works | PASS | "9. editing a future installment works ... records before/after", no-change/invalid, Paid locked, Pending/correction locks; E2E UI edit + locked Paid page |
| 10 | Duplicate obligations prevented | PASS | "10. duplicate obligations are prevented ... (case/space-insensitive)", "10. the database itself rejects a case-variant duplicate"; E2E duplicate refused |
| 11 | Valid verification succeeds | PASS | "11+12. verifying an eligible receipt succeeds, is recorded, ..." |
| 12 | Verified payment counts toward paid total | PASS | same test + "12. only verified payments count ... two installments sum correctly" (P75,000 of P175,000); E2E student dashboard P500.00 |
| 13 | Correction requires remarks | PASS | "13. ..." (missing, blank, 3 chars, 1001 chars - nothing saved); E2E refused without remarks |
| 14 | Correction updates statuses correctly | PASS | "14. ..." submission needs_correction, installment Requires Resubmission, receipt file kept, not paid |
| 15 | Rejection requires a reason | PASS | "15. ..."; E2E |
| 16 | Rejected submission remains in history | PASS | "16. ..." history row, receipt file kept, not paid, installment Overdue/Not Yet Due by due date |
| 17 | Replacement preserves history | PASS | "17. ..." three-link chain, each old review intact, counted once; E2E replacement linked |
| 18 | Duplicate transaction blocked | PASS | "18. ..." student flow (same reference any formatting; same image), DB index, and the review-time check (indexes temporarily dropped to prove the application check, then restored and re-tested) |
| 19 | Invalid state transition rejected | PASS | "19. ..." every decision on every terminal state -> `invalid_transition`, state unchanged |
| 20 | Concurrent review does not double-count | PASS | "20. concurrent review attempts..." 6 simultaneous mixed decisions -> exactly 1 success, 1 review row, 1 notification; "many different receipts"; "reviewing while the student submits a replacement" |
| 21 | Database failure rolls back | PASS | "21. a database failure rolls back the whole review..." (notification table made unavailable AFTER the status and review rows were written -> no review row, status unchanged, `review_failed` error, failure recorded, nothing reported as saved, retry succeeds); "21. an admin-side schedule failure also rolls back" |
| 22 | Student receives the correct in-app notification | PASS | "22. ..." type/title/text per decision, only the right student, `email_pending = true` |
| 23 | Student cannot view another student's receipt | PASS | "23. ..." data layer; E2E (Phase 2 check still passes; admin read path added) |
| 24 | Previous student portal functions still work | PASS | "24. Phase 2 student functions are unchanged after reviews" + all 67 earlier integration tests + 42 earlier E2E checks |

## STEP 10 regression (Phases 1 and 2)
All 34 + 33 earlier integration tests pass unchanged. All 42 earlier browser checks pass (registration, email verification, login/logout and session replay, student dashboard, tracker, calendar, receipt upload, history, student isolation). **One assertion was intentionally changed**: Phase 2 asserted an admin session gets 401 from `/api/receipts/<id>`; D-029 required Phase 3 to add the admin read path, so the check now asserts 200 (private headers) for admin and still asserts the admin gets 401 from the student upload endpoint.

## Additional security / integrity tests added (all PASS)
Append-only review and audit tables (UPDATE and DELETE refused by trigger) · DB check: remarks required for non-verified, whitespace-only refused · one review per submission · reviewer / submission / installment cannot be deleted (FK) · filter and sort runs leave a hash of submissions and obligations unchanged · LIKE wildcards (`%`, `_`, `\`) literal; `'; DROP TABLE users; --` and `' OR '1'='1` are plain text, tables intact · invalid filters dropped and reported · pagination stable and clamped · SQL status CASE agrees with `deriveInstallmentStatus` for 12 scenarios and every status filter · submission/installment/student mismatch refused (`inconsistent`) · amount changed after submission refused (`amount_mismatch`) · duplicate on an already-paid installment refused (`already_paid`) · E2E: admin cookie replay after logout rejected, server log free of receipt bytes / references / remarks.

## Failures encountered during the build (all fixed; none hid an application defect)
1. First `admin.test.ts` run: 47/49. (a) My test fixture used a 1-character period label, so validation fired before the authorization check - fixture corrected. (b) Drizzle wraps database errors as "Failed query ..." and keeps the trigger text in `cause` - added `expectDbError`.
2. Re-run: 1 failure - the audit table was empty in the append-only test, and a row-level trigger cannot fire on zero rows. Added a probe row. The trigger itself was correct.
3. First Phase 3 E2E run: 62/64. `click("text=Reject")` hit the help text ("...or reject...") instead of the button; the second failure was fallout. Switched to a role-based selector. The application was not at fault.

## Full list of Phase 3 integration tests (verbatim run output)
```
Admin dashboard (test 1) > 1. shows zeros on an empty database (nothing hardcoded)
Admin dashboard (test 1) > 1. every number comes from real records and follows changes
Admin dashboard (test 1) > 1. unread admin notifications come from the notifications table
Authorization at the service layer (test 2) > 2. a student (or anyone not the active admin) cannot review, schedule, edit or remove
Authorization at the service layer (test 2) > 2. a deactivated administrator can no longer review
Student record search, filters and sorting (tests 3-7) > 3. search by student name (partial, case-insensitive)
Student record search, filters and sorting (tests 3-7) > 4. search by student ID
Student record search, filters and sorting (tests 3-7) > 5. combined filters: pending receipts from first-year students for October (the LLD example)
Student record search, filters and sorting (tests 3-7) > 6. sorting by student name, submission date and due date (both directions)
Student record search, filters and sorting (tests 3-7) > 7. empty results are an empty list with total 0
Student record search, filters and sorting (tests 3-7) > filters and sorting never change statuses or receipts (read-only)
Student record search, filters and sorting (tests 3-7) > LIKE wildcards are literal and SQL injection text is only data
Student record search, filters and sorting (tests 3-7) > filter input is validated: bad values are dropped and reported
Student record search, filters and sorting (tests 3-7) > pagination: stable pages, total, and out-of-range pages are clamped
Student record search, filters and sorting (tests 3-7) > the SQL status used for filtering agrees with deriveInstallmentStatus for every state
Payment schedule management (tests 8-10) > 8. creates an installment for all active students only (not inactive, not the admin)
Payment schedule management (tests 8-10) > 8. can target one year level or one student (by student ID, any case)
Payment schedule management (tests 8-10) > 8. validates academic year, period, due date and amount; a non-standard amount needs a note
Payment schedule management (tests 8-10) > 10. duplicate obligations are prevented: same student + year + period (case/space-insensitive)
Payment schedule management (tests 8-10) > 10. the database itself rejects a case-variant duplicate
Payment schedule management (tests 8-10) > 9. editing a future installment works, updates the timestamp and records before/after
Payment schedule management (tests 8-10) > 9. no-change and invalid edits are refused; a rename into an existing period is refused
Payment schedule management (tests 8-10) > 9. a Paid installment cannot be changed at all; a verified payment is never silently altered
Payment schedule management (tests 8-10) > 9. while a receipt is pending only the due date can change; with correction/rejection history the amount can, the period cannot
Payment schedule management (tests 8-10) > editRules covers each state
Payment schedule management (tests 8-10) > an installment with no receipts can be removed (recorded); not while an upload is in progress
Payment schedule management (tests 8-10) > existing obligations can be reviewed grouped by year and period; detail view returns rules and history
Receipt verification workflow (tests 11-22) > 11+12. verifying an eligible receipt succeeds, is recorded, and counts toward the paid total
Receipt verification workflow (tests 11-22) > 12. only verified payments count: pending, needs-correction and rejected stay at zero; two installments sum correctly
Receipt verification workflow (tests 11-22) > 22. the student gets the right in-app notification (and only that student), with the email queued
Receipt verification workflow (tests 11-22) > 22. correction and rejection notifications use the right type and text
Receipt verification workflow (tests 11-22) > 13. a correction request requires remarks (missing, blank, too short, too long) and saves nothing without them
Receipt verification workflow (tests 11-22) > 14. a correction request sets the statuses correctly, keeps the original receipt and history, and is not paid
Receipt verification workflow (tests 11-22) > 15. a rejection requires a reason and saves nothing without it
Receipt verification workflow (tests 11-22) > 16. a rejected submission stays in history, keeps its receipt, is not paid, and the installment falls back by due date
Receipt verification workflow (tests 11-22) > 17. a replacement submission after a correction or rejection is linked and preserves the previous history
Receipt verification workflow (tests 11-22) > 19. invalid state transitions are rejected and change nothing
Receipt verification workflow (tests 11-22) > verification re-checks that the submission, installment and student agree, and that the amount is unchanged
Receipt verification workflow (tests 11-22) > 18. a duplicate transaction cannot be counted twice (student flow, DB index, and the review-time check)
Receipt verification workflow (tests 11-22) > 20. concurrent review attempts count the payment once (one winner, one review row, one notification)
Receipt verification workflow (tests 11-22) > 20. concurrent verification of many different receipts counts each exactly once
Receipt verification workflow (tests 11-22) > 20. reviewing while the student submits a replacement for the same installment stays consistent
Receipt verification workflow (tests 11-22) > 21. a database failure rolls back the whole review: no success, no review row, status unchanged, error recorded
Receipt verification workflow (tests 11-22) > 21. an admin-side schedule failure also rolls back (audit write fails -> nothing created)
Access control and review-history integrity (tests 23, 8-audit) > 23. a student cannot read another student's receipt at the data layer; the admin can read any
Access control and review-history integrity (tests 23, 8-audit) > review history is append-only: UPDATE and DELETE are refused by the database, and a decision cannot be rewritten
Access control and review-history integrity (tests 23, 8-audit) > the database enforces: remarks for non-verified decisions, one review per submission, and no deletion of reviewed submissions
Access control and review-history integrity (tests 23, 8-audit) > submission details give the review screen everything it needs (LLD 9.1)
Access control and review-history integrity (tests 23, 8-audit) > 24. Phase 2 student functions are unchanged after reviews: tracker, history, dashboard and remarks
 Test Files  3 passed (3)
      Tests  116 passed (116)
```

## NOT tested / known gaps (be honest)
- **Not deployed**: no GitHub or Vercel access. Migration `0002` (functions + triggers) has only been applied to local embedded PostgreSQL 18, not to Neon/Supabase; confirm the production database role may `CREATE FUNCTION` / `CREATE TRIGGER`.
- **Vercel Blob still never contacted** (unchanged from Phase 2): the admin receipt read goes through the same `storage.read()` abstraction, tested with the memory and local providers only.
- Receipt images in tests are synthetic PNG/JPEG headers + random bytes: the admin screen's `<img>` was verified to request the authorized URL and receive 200, but a real decodable screenshot was not rendered/inspected visually.
- Admin pages tested in desktop Chromium only; no mobile viewport, screen-reader or keyboard-only pass. The records table is wide (horizontal scroll).
- No load test: the records query uses `DISTINCT ON` over submissions per request (fine for a school-sized dataset; revisit with an index or materialization if it grows to hundreds of thousands of rows).
- Email is still not sent (`email_pending` rows only) - Phase 4.
- `npm audit` not reviewed.
