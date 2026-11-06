CREATE TABLE IF NOT EXISTS "batch_plans" (
  "batch" varchar(10) PRIMARY KEY NOT NULL,
  "first_due_date" date NOT NULL,
  "last_due_date" date NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "amount_note" varchar(300),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_plans" ADD CONSTRAINT "batch_plans_updated_by_users_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("user_id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
