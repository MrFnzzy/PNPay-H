/**
 * Deletes receipt uploads that were authorized but never submitted, and retries failed deletions.
 * Safe to run repeatedly. It also runs daily from /api/cron/daily (Vercel Cron). Manual run:  npm run cleanup:uploads
 */
import { closeDb } from "../src/db";
import { cleanupUploads } from "../src/lib/payments/submit";
import { loadLocalEnv } from "./_env";

loadLocalEnv();

cleanupUploads()
  .then(async (r) => {
    console.log(`Expired intents cleaned: ${r.expiredIntents}; orphans deleted: ${r.orphansDeleted}; orphans still failing: ${r.orphansFailed}`);
    await closeDb();
  })
  .catch(async (e) => {
    console.error("Cleanup failed:", e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
