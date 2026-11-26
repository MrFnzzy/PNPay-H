DO $$ BEGIN
  CREATE TYPE "batch_rollover_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'batch_rollover_proposed';--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_batch_valid";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_batch_valid" CHECK ("users"."batch" IS NULL OR "users"."batch" = 'alumni' OR "users"."batch" ~ '^[0-9]{4}$');--> statement-breakpoint
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
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_rollover_proposals" ADD CONSTRAINT "batch_rollover_proposals_decided_by_users_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("user_id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "batch_rollover_pending_key" ON "batch_rollover_proposals" USING btree ("from_batch") WHERE "batch_rollover_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_rollover_status_idx" ON "batch_rollover_proposals" USING btree ("status", "created_at");
