CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('student', 'admin');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"to_email" varchar(254) NOT NULL,
	"template" varchar(50) NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_obligations" (
	"obligation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year" varchar(20) NOT NULL,
	"period_label" varchar(50) NOT NULL,
	"amount_due" numeric(10, 2) NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_obligations_amount_positive" CHECK ("payment_obligations"."amount_due" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"event_id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"student_id" varchar(30),
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"course" varchar(100),
	"year_level" smallint,
	"role" "role" DEFAULT 'student' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_year_level_range" CHECK ("users"."year_level" IS NULL OR "users"."year_level" BETWEEN 1 AND 6),
	CONSTRAINT "users_student_needs_student_id" CHECK ("users"."role" = 'admin' OR "users"."student_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_student_id_users_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_user_idx" ON "email_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_hash_key" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expires_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_obligations_student_period_key" ON "payment_obligations" USING btree ("student_id","academic_year","period_label");--> statement-breakpoint
CREATE INDEX "payment_obligations_student_due_idx" ON "payment_obligations" USING btree ("student_id","due_date");--> statement-breakpoint
CREATE INDEX "payment_obligations_due_date_idx" ON "payment_obligations" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "rate_limit_events_key_idx" ON "rate_limit_events" USING btree ("key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_student_id_key" ON "users" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'admin';