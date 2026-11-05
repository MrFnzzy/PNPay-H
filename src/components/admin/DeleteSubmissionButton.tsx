"use client";

import { deleteSubmissionAction } from "@/app/actions/admin";
import { SubmitButton } from "@/components/ui";

type DeletableStatus = "pending_review" | "verified";

export default function DeleteSubmissionButton({ submissionId, status }: { submissionId: string; status: DeletableStatus }) {
  const verified = status === "verified";
  const message = verified
    ? "Delete this verified payment submission and its receipt? The review and audit history will remain, the installment schedule will stay, and the student can submit a replacement."
    : "Delete this submitted payment? This removes the pending review and uploaded receipt permanently.";

  return (
    <form action={deleteSubmissionAction} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <SubmitButton className="btn btn-danger" pending="Deleting payment…">{verified ? "Delete verified payment" : "Delete submitted payment"}</SubmitButton>
      <small className="delete-note">{verified ? "The review decision stays in the audit history." : "Only available before an administrator reviews it."}</small>
    </form>
  );
}
