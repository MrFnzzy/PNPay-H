"use client";

import { useActionState } from "react";
import { deleteAccountAction, type SubmitState } from "@/app/actions/student";
import { Alert, SubmitButton } from "@/components/ui";

const initial: SubmitState = {};

export default function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccountAction, initial);
  return (
    <form action={action} className="card" aria-label="Delete my account">
      <h2 className="section" style={{ marginTop: 0 }}>Delete my account</h2>
      <p className="muted">
        This permanently deletes your account, your scheduled installments, every receipt you uploaded and your notifications. It cannot be undone, and the administrator will no longer see your records.
        If you only want to stop using the system, you can simply log out instead.
      </p>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <div className="field"><label htmlFor="del-password">Your password</label><input id="del-password" name="password" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="del-confirm">Type DELETE to confirm</label><input id="del-confirm" name="confirm" autoComplete="off" required /></div>
      <SubmitButton className="btn btn-danger" pending="Deleting…">Delete my account permanently</SubmitButton>
    </form>
  );
}
