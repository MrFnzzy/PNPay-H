import { INSTALLMENT_LABEL, SUBMISSION_LABEL, type InstallmentStatus, type SubmissionStatus } from "@/lib/payments/status";

export function InstallmentPill({ status }: { status: InstallmentStatus }) {
  return <span className={`pill s-${status}`}>{INSTALLMENT_LABEL[status]}</span>;
}
export function SubmissionPill({ status }: { status: SubmissionStatus }) {
  return <span className={`pill s-${status}`}>{SUBMISSION_LABEL[status]}</span>;
}
