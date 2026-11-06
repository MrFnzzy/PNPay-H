-- Deleting a student account removes the student's installments and receipts. The append-only review log is kept but
-- detached (obligation_id and submission_id become NULL), exactly like deleting a single verified payment (migration 0007).
ALTER TABLE "payment_reviews" ALTER COLUMN "obligation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_reviews" DROP CONSTRAINT IF EXISTS "payment_reviews_obligation_id_payment_obligations_obligation_id_fk";--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_obligation_id_payment_obligations_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("obligation_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pnpay_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
BEGIN
  -- The only change ever allowed on the review log: detaching a deleted submission or installment (set to NULL), nothing else altered.
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
$$;
