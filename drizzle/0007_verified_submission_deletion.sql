ALTER TABLE "payment_reviews" DROP CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk";--> statement-breakpoint
ALTER TABLE "payment_reviews" ALTER COLUMN "submission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_submission_id_payment_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."payment_submissions"("submission_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pnpay_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'payment_reviews' AND TG_OP = 'UPDATE' AND (to_jsonb(OLD)->>'submission_id') IS NOT NULL AND (to_jsonb(NEW)->>'submission_id') IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
