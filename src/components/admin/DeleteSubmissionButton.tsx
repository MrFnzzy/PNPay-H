"use client";

import { deleteSubmissionAction } from "@/app/actions/admin";
import { SubmitButton } from "@/components/ui";

type DeletableStatus = "pending_review" | "verified";

/** `returnTo` (an admin student-record path) sends the admin back there after deleting; `compact` drops the explanatory note (for table rows). */
export default function DeleteSubmissionButton({ submissionId, status, returnTo, compact }: { submissionId: string; status: DeletableStatus; returnTo?: string; compact?: boolean }) {
  const verified = status === "verified";
  const message = verified
    ? "Delete this verified payment and its receipt? The review and audit history will remain, the installment stays on the schedule (it becomes unpaid), and the student can submit a replacement."
    : "Delete this submitted payment? This removes the pending review and uploaded receipt permanently.";

  return (
    <form action={deleteSubmissionAction} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
      <input type="hidden" name="submissionId" value={submissionId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <SubmitButton className="btn btn-danger" pending="Deleting payment…">{verified ? "Delete verified payment" : "Delete submitted payment"}</SubmitButton>
      {!compact && <small className="delete-note">{verified ? "The review decision stays in the audit history." : "Only available before an administrator reviews it."}</small>}
    </form>
  );
}
