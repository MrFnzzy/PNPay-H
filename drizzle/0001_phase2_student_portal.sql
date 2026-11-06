CREATE TYPE "public"."notification_type" AS ENUM('submission_received', 'submission_verified', 'correction_requested', 'submission_rejected', 'payment_reminder', 'installment_overdue');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending_review', 'verified', 'needs_correction', 'rejected');--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(150) NOT NULL,
	"message" varchar(500) NOT NULL,
	"submission_id" uuid,
	"obligation_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"email_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orphaned_uploads" (
	"orphan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"reason" varchar(100) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_submissions" (
	"submission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"previous_submission_id" uuid,
	"amount_submitted" numeric(10, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"reference_number" varchar(40),
	"reference_normalized" varchar(40),
	"receipt_key" varchar(200) NOT NULL,
	"receipt_mime" varchar(20) NOT NULL,
	"receipt_size" integer NOT NULL,
	"receipt_sha256" varchar(64) NOT NULL,
	"status" "submission_status" DEFAULT 'pending_review' NOT NULL,
	"remarks" varchar(1000),
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "payment_submissions_amount_positive" CHECK ("payment_submissions"."amount_submitted" > 0),
	CONSTRAINT "payment_submissions_size_positive" CHECK ("payment_submissions"."receipt_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_upload_intents" (
	"intent_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_student_id_users_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_previous_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("previous_submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_upload_intents" ADD CONSTRAINT "receipt_upload_intents_student_id_users_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_upload_intents" ADD CONSTRAINT "receipt_upload_intents_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("email_pending");--> statement-breakpoint
CREATE UNIQUE INDEX "orphaned_uploads_key_key" ON "orphaned_uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "orphaned_uploads_pending_idx" ON "orphaned_uploads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "payment_submissions_student_idx" ON "payment_submissions" USING btree ("student_id","submitted_at");--> statement-breakpoint
CREATE INDEX "payment_submissions_obligation_idx" ON "payment_submissions" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "payment_submissions_status_idx" ON "payment_submissions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_one_open_per_obligation" ON "payment_submissions" USING btree ("obligation_id") WHERE "payment_submissions"."status" IN ('pending_review','verified');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_open_reference_key" ON "payment_submissions" USING btree ("reference_normalized") WHERE "payment_submissions"."reference_normalized" IS NOT NULL AND "payment_submissions"."status" IN ('pending_review','verified');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_open_receipt_hash_key" ON "payment_submissions" USING btree ("receipt_sha256") WHERE "payment_submissions"."status" IN ('pending_review','verified');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_submissions_receipt_key_key" ON "payment_submissions" USING btree ("receipt_key");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_upload_intents_key_key" ON "receipt_upload_intents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "receipt_upload_intents_student_idx" ON "receipt_upload_intents" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "receipt_upload_intents_expiry_idx" ON "receipt_upload_intents" USING btree ("expires_at");