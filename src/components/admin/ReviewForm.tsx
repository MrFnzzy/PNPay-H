"use client";

import { useActionState, useState } from "react";
import { reviewSubmissionAction, type AdminFormState } from "@/app/actions/admin";
import { Alert } from "@/components/ui";

const initial: AdminFormState = {};

/** The three decisions. Remarks are required for correction and rejection (checked again on the server). */
export default function ReviewForm({ submissionId, remarksMin }: { submissionId: string; remarksMin: number }) {
  const [state, action, pending] = useActionState(reviewSubmissionAction, initial);
  const [remarks, setRemarks] = useState("");
  return (
    <form action={action} className="card" aria-label="Review decision">
      <h2 className="section" style={{ marginTop: 0 }}>Review decision</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="field">
        <label htmlFor="remarks">Remarks</label>
        <textarea id="remarks" name="remarks" rows={4} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <small>Required to request a correction or reject (at least {remarksMin} characters). Optional when verifying. The student can read these remarks.</small>
      </div>
      <div className="row">
        <button className="btn" type="submit" name="decision" value="verified" disabled={pending}>Verify payment</button>
        <button className="btn btn-secondary" type="submit" name="decision" value="needs_correction" disabled={pending}>Request correction</button>
        <button className="btn btn-danger" type="submit" name="decision" value="rejected" disabled={pending}>Reject</button>
      </div>
    </form>
  );
}
