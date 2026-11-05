CREATE TYPE "public"."review_decision" AS ENUM('verified', 'needs_correction', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_reviews" (
	"review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"previous_status" "submission_status" NOT NULL,
	"remarks" varchar(1000),
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reviews_remarks_required" CHECK ("payment_reviews"."decision" = 'verified' OR length(btrim(coalesce("payment_reviews"."remarks", ''))) > 0)
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_admin_id_users_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_admin_id_users_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reviews_one_per_submission" ON "payment_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "payment_reviews_admin_idx" ON "payment_reviews" USING btree ("admin_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "payment_reviews_obligation_idx" ON "payment_reviews" USING btree ("obligation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_obligations_student_period_ci_key" ON "payment_obligations" USING btree ("student_id","academic_year",lower("period_label"));--> statement-breakpoint
CREATE FUNCTION "pnpay_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501'; END; $$;--> statement-breakpoint
CREATE TRIGGER "payment_reviews_append_only" BEFORE UPDATE OR DELETE ON "payment_reviews" FOR EACH ROW EXECUTE FUNCTION "pnpay_forbid_change"();--> statement-breakpoint
CREATE TRIGGER "admin_audit_events_append_only" BEFORE UPDATE OR DELETE ON "admin_audit_events" FOR EACH ROW EXECUTE FUNCTION "pnpay_forbid_change"();
