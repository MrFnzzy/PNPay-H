"use client";

import { useActionState } from "react";
import { deleteStudentAction, type AdminFormState } from "@/app/actions/admin";
import { Alert, SubmitButton } from "@/components/ui";

const initial: AdminFormState = {};

export default function DeleteStudentForm({ studentUserId, studentCode, name }: { studentUserId: string; studentCode: string; name: string }) {
  const [state, action] = useActionState(deleteStudentAction, initial);
  return (
    <form action={action} className="card danger-zone" aria-label="Delete student account">
      <h2 className="section" style={{ marginTop: 0 }}>Delete this student</h2>
      <p className="muted">
        Permanently deletes <strong>{name}</strong>: the account, all installments, every receipt and notification. This cannot be undone. The deletion is recorded in the audit history (student ID, batch and counts only).
      </p>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="studentUserId" value={studentUserId} />
      <div className="field"><label htmlFor="del-student-confirm">Type the student ID <strong>{studentCode}</strong> to confirm</label><input id="del-student-confirm" name="confirm" autoComplete="off" required /></div>
      <SubmitButton className="btn btn-danger" pending="Deleting…">Delete student permanently</SubmitButton>
    </form>
  );
}
