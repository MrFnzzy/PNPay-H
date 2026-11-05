ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "batch" varchar(10);--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_batch_valid') THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_batch_valid" CHECK ("users"."batch" IS NULL OR "users"."batch" IN ('2026', '2027', 'alumni'));
	END IF;
END $$;
