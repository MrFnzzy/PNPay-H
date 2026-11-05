import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { UserFacingError, pgErrorInfo } from "@/lib/errors";
import { manilaToday } from "@/lib/payments/dates";
import { dispatchPaymentEvent, type PaymentEvent } from "@/lib/payments/events";
import { toCents } from "@/lib/payments/money";
import { deriveInstallmentStatus, type InstallmentStatus, type SubmissionStatus } from "@/lib/payments/status";

const { paymentObligations: ob, paymentSubmissions: sub, paymentReviews: reviews, users, adminAuditEvents } = schema;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const REVIEW_DECISIONS = ["verified", "needs_correction", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const DECISION_LABEL: Record<ReviewDecision, string> = { verified: "Verified", needs_correction: "Needs Correction", rejected: "Rejected" };
export const REMARKS_MIN = 5;
export const REMARKS_MAX = 1000;

const reviewInput = z
  .object({
    submissionId: z.string().uuid("Invalid submission."),
    decision: z.enum(REVIEW_DECISIONS, { errorMap: () => ({ message: "Choose Verify, Request correction or Reject." }) }),
    remarks: z
      .string()
      .trim()
      .max(REMARKS_MAX, `Remarks must be ${REMARKS_MAX} characters or fewer.`)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "verified" && (v.remarks?.length ?? 0) < REMARKS_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remarks"],
        message:
          v.decision === "rejected"
            ? `Enter the reason for rejecting this receipt (at least ${REMARKS_MIN} characters).`
            : `Explain what the student needs to correct (at least ${REMARKS_MIN} characters).`,
      });
    }
  });

/** Defence in depth: besides requireRole() at the edge, the service re-checks that the actor is the active administrator. */
export async function assertAdmin(db: ReturnType<typeof getDb> | Tx, adminId: string): Promise<void> {
  const [a] = await db
    .select({ userId: users.userId })
    .from(users)
    .where(and(eq(users.userId, adminId), eq(users.role, "admin"), eq(users.isActive, true)));
  if (!a) throw new UserFacingError("You are not allowed to do that.", "forbidden", 403);
}

const STATE_MESSAGE: Record<Exclude<SubmissionStatus, "pending_review">, string> = {
  verified: "This receipt was already verified. A verified payment cannot be changed.",
  needs_correction: "A correction was already requested for this receipt. It is replaced by a new submission from the student.",
  rejected: "This receipt was already rejected. It is replaced by a new submission from the student.",
};

export interface ReviewResult {
  submissionId: string;
  decision: ReviewDecision;
  submissionStatus: SubmissionStatus;
  installmentStatus: InstallmentStatus;
  reviewedAt: Date;
}

/**
 * LLD 9.2. ONE transaction covers: lock installment + submission, eligibility and duplicate checks, the submission
 * status, the review-history row and the student notification. Any failure rolls everything back and no success is
 * returned. Lock order (installment, then submission) matches submitReceipt() so the two cannot deadlock.
 * Installment status is derived (D-020): once the submission row changes inside this transaction, the derived
 * installment status changes with it, so the two can never disagree.
 */
export async function reviewSubmission(adminId: string, raw: Record<string, unknown>, now = new Date()): Promise<ReviewResult> {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Please check the form.", "invalid_input", 422);
  const { submissionId, decision, remarks } = parsed.data;
  const today = manilaToday(now);

  try {
    return await getDb().transaction(async (tx): Promise<ReviewResult> => {
      await assertAdmin(tx, adminId);

      const [peek] = await tx.select({ obligationId: sub.obligationId }).from(sub).where(eq(sub.submissionId, submissionId));
      if (!peek) throw new UserFacingError("That submission was not found.", "not_found", 404);

      const [o] = await tx.select().from(ob).where(eq(ob.obligationId, peek.obligationId)).for("update");
      const [s] = await tx.select().from(sub).where(eq(sub.submissionId, submissionId)).for("update");
      if (!o || !s) throw new UserFacingError("That submission was not found.", "not_found", 404);

      // Relationship check: the submission, its installment and its student must agree.
      if (s.obligationId !== o.obligationId || s.studentId !== o.studentId) {
        throw new UserFacingError("This submission does not match its installment. It cannot be reviewed.", "inconsistent", 409);
      }
      // Eligibility / valid transition: only Pending Review can be decided (D-031).
      if (s.status !== "pending_review") throw new UserFacingError(STATE_MESSAGE[s.status], "invalid_transition", 409);

      if (decision === "verified") {
        if (toCents(s.amountSubmitted) !== toCents(o.amountDue)) {
          throw new UserFacingError("The installment amount changed after this receipt was submitted. Request a correction so the student can submit again.", "amount_mismatch", 409);
        }
        // Duplicate-transaction protection. The partial unique indexes make these states impossible through normal
        // flows (D-023); the explicit checks give a clear message and guard against any bypass.
        const [alreadyPaid] = await tx
          .select({ id: sub.submissionId })
          .from(sub)
          .where(and(eq(sub.obligationId, o.obligationId), eq(sub.status, "verified"), ne(sub.submissionId, s.submissionId)))
          .limit(1);
        if (alreadyPaid) throw new UserFacingError("This installment already has a verified payment.", "already_paid", 409);
        if (s.referenceNormalized) {
          const [dup] = await tx
            .select({ id: sub.submissionId })
            .from(sub)
            .where(and(eq(sub.referenceNormalized, s.referenceNormalized), eq(sub.status, "verified"), ne(sub.submissionId, s.submissionId)))
            .limit(1);
          if (dup) throw new UserFacingError("This transaction reference is already counted for a verified payment.", "duplicate_transaction", 409);
        }
        const [dupImage] = await tx
          .select({ id: sub.submissionId })
          .from(sub)
          .where(and(eq(sub.receiptSha256, s.receiptSha256), eq(sub.status, "verified"), ne(sub.submissionId, s.submissionId)))
          .limit(1);
        if (dupImage) throw new UserFacingError("This receipt image is already counted for a verified payment.", "duplicate_transaction", 409);
      }

      // Conditional update: succeeds for exactly one concurrent reviewer.
      const [updated] = await tx
        .update(sub)
        .set({ status: decision, remarks: remarks ?? null, reviewedAt: now })
        .where(and(eq(sub.submissionId, s.submissionId), eq(sub.status, "pending_review")))
        .returning({ submissionId: sub.submissionId });
      if (!updated) throw new UserFacingError("This receipt was already reviewed.", "invalid_transition", 409);

      await tx.insert(reviews).values({
        submissionId: s.submissionId,
        obligationId: o.obligationId,
        adminId,
        decision,
        previousStatus: "pending_review",
        remarks: remarks ?? null,
        reviewedAt: now,
      });

      const base = { submissionId: s.submissionId, studentId: s.studentId, obligationId: o.obligationId, periodLabel: o.periodLabel };
      const event: PaymentEvent =
        decision === "verified" ? { type: "submission_verified", ...base } : decision === "needs_correction" ? { type: "correction_requested", ...base } : { type: "submission_rejected", ...base };
      await dispatchPaymentEvent(tx, event);

      const subs = await tx.select({ status: sub.status, submittedAt: sub.submittedAt }).from(sub).where(eq(sub.obligationId, o.obligationId));
      return { submissionId: s.submissionId, decision, submissionStatus: decision, installmentStatus: deriveInstallmentStatus(o.dueDate, today, subs), reviewedAt: now };
    });
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    const { code, constraint } = pgErrorInfo(e);
    if (code === "23505") {
      if (constraint === "payment_reviews_one_per_submission") throw new UserFacingError("This receipt was already reviewed.", "invalid_transition", 409);
      if (constraint === "payment_submissions_open_reference_key" || constraint === "payment_submissions_open_receipt_hash_key") {
        throw new UserFacingError("This transaction was already counted for another payment.", "duplicate_transaction", 409);
      }
    }
    // Rolled back. Record a server-side error (no receipt or personal data) and show nothing as saved.
    console.error("[pnpay] review failed and was rolled back:", code ?? (e instanceof Error ? e.name : "unknown"));
    await getDb()
      .insert(adminAuditEvents)
      .values({ adminId, action: "review_failed", entityType: "submission", entityId: submissionId, details: { decision, errorCode: code ?? "unknown" } })
      .catch(() => console.error("[pnpay] could not record the review failure"));
    throw new UserFacingError("We could not save the review. Nothing was changed. Please try again.", "review_failed", 500);
  }
}

/** LLD 9.1 - everything the review screen needs. Caller MUST have passed requireRole("admin"). Returns null when not found. */
export async function getSubmissionDetails(submissionId: string, today = manilaToday()) {
  if (!z.string().uuid().safeParse(submissionId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({
      submissionId: sub.submissionId,
      obligationId: sub.obligationId,
      studentId: sub.studentId,
      status: sub.status,
      amountSubmitted: sub.amountSubmitted,
      paymentDate: sub.paymentDate,
      paymentMethod: sub.paymentMethod,
      referenceNumber: sub.referenceNumber,
      receiptMime: sub.receiptMime,
      receiptSize: sub.receiptSize,
      remarks: sub.remarks,
      submittedAt: sub.submittedAt,
      reviewedAt: sub.reviewedAt,
      previousSubmissionId: sub.previousSubmissionId,
      studentName: users.fullName,
      studentCode: users.studentId,
      yearLevel: users.yearLevel,
      course: users.course,
      academicYear: ob.academicYear,
      periodLabel: ob.periodLabel,
      amountDue: ob.amountDue,
      dueDate: ob.dueDate,
    })
    .from(sub)
    .innerJoin(users, eq(users.userId, sub.studentId))
    .innerJoin(ob, eq(ob.obligationId, sub.obligationId))
    .where(eq(sub.submissionId, submissionId));
  if (!row) return null;

  const attempts = await db
    .select({
      submissionId: sub.submissionId,
      status: sub.status,
      submittedAt: sub.submittedAt,
      paymentDate: sub.paymentDate,
      paymentMethod: sub.paymentMethod,
      referenceNumber: sub.referenceNumber,
      remarks: sub.remarks,
      previousSubmissionId: sub.previousSubmissionId,
    })
    .from(sub)
    .where(eq(sub.obligationId, row.obligationId))
    .orderBy(asc(sub.submittedAt));
  const decisions = await db
    .select({ reviewId: reviews.reviewId, submissionId: reviews.submissionId, decision: reviews.decision, remarks: reviews.remarks, reviewedAt: reviews.reviewedAt, adminName: users.fullName })
    .from(reviews)
    .innerJoin(users, eq(users.userId, reviews.adminId))
    .where(eq(reviews.obligationId, row.obligationId))
    .orderBy(asc(reviews.reviewedAt));

  const installmentStatus = deriveInstallmentStatus(row.dueDate, today, attempts);
  return {
    ...row,
    amountSubmittedCents: toCents(row.amountSubmitted),
    amountDueCents: toCents(row.amountDue),
    installmentStatus,
    canReview: row.status === "pending_review",
    history: attempts.map((a) => ({ ...a, review: decisions.find((d) => d.submissionId === a.submissionId) ?? null })),
  };
}

/** Receipt metadata for the administrator. Caller MUST have passed an admin check (route handler / page guard). */
export async function getReceiptForAdmin(submissionId: string) {
  const [row] = await getDb()
    .select({ key: sub.receiptKey, mime: sub.receiptMime, size: sub.receiptSize })
    .from(sub)
    .where(eq(sub.submissionId, submissionId));
  return row ?? null;
}
