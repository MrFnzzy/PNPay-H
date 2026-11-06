-- PNPay-H: paste into Neon > SQL Editor ONLY if 'npm run db:migrate' cannot be used. Brings a database that has migrations 0000-0005 up to 0008.
DO $$ BEGIN
  CREATE TYPE "batch_rollover_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'batch_rollover_proposed';
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_batch_valid";
ALTER TABLE "users" ADD CONSTRAINT "users_batch_valid" CHECK ("users"."batch" IS NULL OR "users"."batch" = 'alumni' OR "users"."batch" ~ '^[0-9]{4}$');
CREATE TABLE IF NOT EXISTS "batch_rollover_proposals" (
  "proposal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_batch" varchar(10) NOT NULL,
  "to_batch" varchar(10) DEFAULT 'alumni' NOT NULL,
  "effective_date" date NOT NULL,
  "affected_students" integer DEFAULT 0 NOT NULL,
  "status" "batch_rollover_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by" uuid
);
DO $$ BEGIN
  ALTER TABLE "batch_rollover_proposals" ADD CONSTRAINT "batch_rollover_proposals_decided_by_users_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("user_id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "batch_rollover_pending_key" ON "batch_rollover_proposals" USING btree ("from_batch") WHERE "batch_rollover_proposals"."status" = 'pending';
CREATE INDEX IF NOT EXISTS "batch_rollover_status_idx" ON "batch_rollover_proposals" USING btree ("status", "created_at");
ALTER TABLE "payment_reviews" DROP CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk";
ALTER TABLE "payment_reviews" ALTER COLUMN "submission_id" DROP NOT NULL;
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE set null ON UPDATE no action;
CREATE OR REPLACE FUNCTION "pnpay_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'payment_reviews' AND TG_OP = 'UPDATE' AND (to_jsonb(OLD)->>'submission_id') IS NOT NULL AND (to_jsonb(NEW)->>'submission_id') IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;
CREATE TABLE IF NOT EXISTS "batch_plans" (
  "batch" varchar(10) PRIMARY KEY NOT NULL,
  "first_due_date" date NOT NULL,
  "last_due_date" date NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "amount_note" varchar(300),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
DO $$ BEGIN
  ALTER TABLE "batch_plans" ADD CONSTRAINT "batch_plans_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("user_id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
