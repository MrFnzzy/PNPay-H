"use client";

import { deleteSubmissionAction } from "@/app/actions/admin";

type DeletableStatus = "pending_review" | "verified";

export default function DeleteSubmissionButton({ submissionId, status }: { submissionId: string; status: DeletableStatus }) {
  const verified = status === "verified";
  const message = verified
    ? "Delete this verified payment? The payment and receipt will be removed, its review history will remain in the audit log, and the student can submit a replacement."
    : "Delete this submitted payment? This removes the pending review and uploaded receipt permanently.";

  return (
    <form action={deleteSubmissionAction} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <button className="btn btn-danger" type="submit">{verified ? "Delete verified payment" : "Delete submitted payment"}</button>
      <small className="delete-note">{verified ? "The review decision stays in the audit history." : "Only available before an administrator reviews it."}</small>
    </form>
  );
}
