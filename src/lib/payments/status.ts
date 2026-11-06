/**
 * Installment status is DERIVED from the due date and the installment's submissions (LLD section 9).
 * It is never stored, never supplied by the client, and is kept separate from submission status.
 */
export type SubmissionStatus = "pending_review" | "verified" | "needs_correction" | "rejected";
export type InstallmentStatus = "not_yet_due" | "pending_verification" | "paid" | "requires_resubmission" | "overdue";

export const INSTALLMENT_LABEL: Record<InstallmentStatus, string> = {
  not_yet_due: "Not Yet Due",
  pending_verification: "Pending Verification",
  paid: "Paid",
  requires_resubmission: "Requires Resubmission",
  overdue: "Overdue",
};

export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  pending_review: "Pending Review",
  verified: "Verified",
  needs_correction: "Needs Correction",
  rejected: "Rejected",
};

export interface SubmissionLike {
  status: SubmissionStatus;
  submittedAt: Date;
}

export function deriveInstallmentStatus(dueDate: string, today: string, submissions: SubmissionLike[]): InstallmentStatus {
  if (submissions.some((s) => s.status === "verified")) return "paid";
  if (submissions.some((s) => s.status === "pending_review")) return "pending_verification";
  const latest = [...submissions].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())[0];
  if (latest?.status === "needs_correction") return "requires_resubmission";
  // No submission, or the latest one was rejected: unpaid, so only the due date matters.
  return dueDate < today ? "overdue" : "not_yet_due";
}

/** Unpaid installments past their due date and not awaiting review (D-018). */
export function countsAsOverdue(status: InstallmentStatus, dueDate: string, today: string): boolean {
  return dueDate < today && (status === "overdue" || status === "requires_resubmission");
}

/** A student may submit a receipt unless the installment is Paid or already awaiting review. */
export function isSubmittable(status: InstallmentStatus): boolean {
  return status !== "paid" && status !== "pending_verification";
}
