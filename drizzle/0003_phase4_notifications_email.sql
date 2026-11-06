CREATE TYPE "public"."notification_email_status" AS ENUM('not_applicable', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('due_soon', 'overdue');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(40) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "payment_reminders" (
	"reminder_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"due_date" date NOT NULL,
	"notification_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "notification_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_status" "notification_email_status" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_last_error" varchar(500);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_notification_id_notifications_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("notification_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reminders_once" ON "payment_reminders" USING btree ("obligation_id","kind","due_date");--> statement-breakpoint
CREATE INDEX "payment_reminders_created_idx" ON "payment_reminders" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_notification_id_notifications_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("notification_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_notification_idx" ON "email_deliveries" USING btree ("notification_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email_queue_idx" ON "notifications" USING btree ("email_next_attempt_at") WHERE "notifications"."email_pending" = true;--> statement-breakpoint
CREATE INDEX "notifications_email_status_idx" ON "notifications" USING btree ("email_status","created_at");--> statement-breakpoint
-- Hand-written backfill (Phase 4): notifications queued by Phases 2-3 (email_pending = true) become 'queued' and are
-- picked up by the new email worker. Must run BEFORE the check constraint below or the migration would fail on real data.
UPDATE "notifications" SET "email_status" = 'queued', "email_next_attempt_at" = now() WHERE "email_pending" = true;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_state" CHECK ("notifications"."email_pending" = false OR "notifications"."email_status" = 'queued');