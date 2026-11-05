"use client";

import { deletePendingSubmissionAction } from "@/app/actions/admin";

export default function DeleteSubmissionButton({ submissionId }: { submissionId: string }) {
  return <form action={deletePendingSubmissionAction} onSubmit={(event) => { if (!window.confirm("Delete this submitted payment? This removes the pending review and uploaded receipt permanently.")) event.preventDefault(); }}><input type="hidden" name="submissionId" value={submissionId} /><button className="btn btn-danger" type="submit">Delete submitted payment</button><small className="delete-note">Only available before an administrator reviews it.</small></form>;
}
