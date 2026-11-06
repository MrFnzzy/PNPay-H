import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { UserFacingError } from "@/lib/errors";

/**
 * Deleting a verified payment (or an installment / student that has one) needs the review log to be DETACHABLE:
 * payment_reviews.submission_id / obligation_id nullable with ON DELETE SET NULL, and the append-only trigger allowing only that
 * detach. That is migrations 0007 and 0009. A database that never had them applied makes every such delete fail.
 *
 * So the app checks this itself, once per process, and applies the same idempotent statements when they are missing: an
 * administrator is never blocked from deleting a verified payment because someone forgot `npm run db:migrate`.
 */
const STATEMENTS = [
  `ALTER TABLE "payment_reviews" DROP CONSTRAINT IF EXISTS "payment_reviews_submission_id_payment_submissions_submission_id_fk"`,
  `ALTER TABLE "payment_reviews" ALTER COLUMN "submission_id" DROP NOT NULL`,
  `ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE set null ON UPDATE no action`,
  `ALTER TABLE "payment_reviews" ALTER COLUMN "obligation_id" DROP NOT NULL`,
  `ALTER TABLE "payment_reviews" DROP CONSTRAINT IF EXISTS "payment_reviews_obligation_id_payment_obligations_obligation_id_fk"`,
  `ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE set null ON UPDATE no action`,
  `CREATE OR REPLACE FUNCTION "pnpay_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  old_j jsonb;
  new_j jsonb;
BEGIN
  IF TG_TABLE_NAME = 'payment_reviews' AND TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    IF ((old_j->>'submission_id') IS NOT NULL AND (new_j->>'submission_id') IS NULL
        OR (old_j->>'obligation_id') IS NOT NULL AND (new_j->>'obligation_id') IS NULL)
       AND (new_j - 'submission_id' - 'obligation_id') = (old_j - 'submission_id' - 'obligation_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$fn$`,
];

const g = globalThis as unknown as { __pnpayDeletionSchemaOk?: boolean };

/** Test hook. */
export function resetDeletionSchemaCache() {
  g.__pnpayDeletionSchemaOk = false;
}

async function isReady(): Promise<boolean> {
  const res = await getDb().execute(sql`
    SELECT
      (SELECT bool_and(is_nullable = 'YES') FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'payment_reviews' AND column_name IN ('submission_id', 'obligation_id')) AS nullable_ok,
      (SELECT count(*) = 2 AND bool_and(confdeltype = 'n') FROM pg_constraint
         WHERE conname IN ('payment_reviews_submission_id_payment_submissions_submission_id_fk', 'payment_reviews_obligation_id_payment_obligations_obligation_id_fk')) AS fk_ok,
      (SELECT bool_or(pg_get_functiondef(p.oid) LIKE '%old_j%') FROM pg_proc p WHERE p.proname = 'pnpay_forbid_change') AS fn_ok
  `);
  const r = (res.rows as { nullable_ok: boolean | null; fk_ok: boolean | null; fn_ok: boolean | null }[])[0];
  return Boolean(r?.nullable_ok && r.fk_ok && r.fn_ok);
}

/** Makes sure verified payments can be deleted. Cheap after the first success in a process. */
export async function ensureDeletionSchema(): Promise<void> {
  if (g.__pnpayDeletionSchemaOk) return;
  try {
    if (!(await isReady())) {
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7340191)`); // two requests must not run the DDL at once
        for (const stmt of STATEMENTS) await tx.execute(sql.raw(stmt));
      });
    }
    g.__pnpayDeletionSchemaOk = true;
  } catch (e) {
    console.error("[pnpay] could not prepare the database for deleting verified payments:", e instanceof Error ? e.name : "unknown");
    throw new UserFacingError(
      "The database needs a one-time update before verified payments can be deleted, and the app's database user is not allowed to apply it. Run `npm run db:migrate` once.",
      "schema_outdated",
      500,
    );
  }
}
