# PNPay-H visual redesign handoff

This copy preserves the existing authentication, database schema, server actions, storage adapters, cron routes, receipt APIs, and tests. The redesign is implemented in the presentation layer plus one read-only admin route.

## Main UI changes

- Reworked the shared student/admin shell into a responsive sidebar layout.
- Applied the supplied aqua/orange ruled-paper visual language: rounded cards, bold status pills, playful month tiles, and warm orange accents.
- Redesigned the public landing page while preserving `/login`, `/register`, and `/admin/login` destinations.
- Added `/admin/monthly-review`, a read-only month tile view that links to the existing `/admin/records?month=YYYY-MM` filters.
- Added `public/manus-routes.json` for the page route manifest.

## Deployment

Run `npm ci`, provide the existing environment variables from `.env.example`, run database migrations as documented in `docs/DEPLOYMENT.md`, and deploy the project root to Vercel. `node_modules`, `.next`, and local environment files are intentionally excluded from the delivery archive.

## Validation

- `npm run typecheck` passed.
- `npm run build` passed.
- Build produced only a non-blocking CSS autoprefixer warning, which was removed in the final source copy.
