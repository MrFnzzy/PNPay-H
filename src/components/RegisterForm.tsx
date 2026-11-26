"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerAction, type FormState } from "@/app/actions/auth";
import { batchOptionLabel } from "@/lib/batches";
import { Alert, Field, SubmitButton } from "./ui";

export default function RegisterForm({ batches }: { batches: string[] }) {
  const [state, action] = useActionState<FormState, FormData>(registerAction, {});
  const [clientError, setClientError] = useState<string>();

  if (state.ok) {
    return (
      <>
        <Alert kind="success">{state.message}</Alert>
        <p>
          <Link href="/resend-verification">Resend verification email</Link> · <Link href="/login">Go to login</Link>
        </p>
      </>
    );
  }
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form
      action={action}
      noValidate={false}
      onSubmit={(ev) => {
        const fd = new FormData(ev.currentTarget);
        if (fd.get("password") !== fd.get("confirmPassword")) {
          ev.preventDefault();
          setClientError("Passwords do not match.");
        } else setClientError(undefined);
      }}
    >
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <Field label="Full name" name="fullName" defaultValue={v.fullName} error={e.fullName} autoComplete="name" required maxLength={150} />
      <Field label="Student ID" name="studentId" defaultValue={v.studentId} error={e.studentId} required maxLength={30} />
      <Field label="Email" name="email" type="email" defaultValue={v.email} error={e.email} autoComplete="email" required maxLength={254} />
      <Field label="Course (optional)" name="course" defaultValue={v.course} error={e.course} maxLength={100} />
      <div className="field">
        <label htmlFor="batch">Batch</label>
        <select id="batch" name="batch" required defaultValue={v.batch ?? ""}>
          <option value="" disabled>
            Select…
          </option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {batchOptionLabel(b)}
            </option>
          ))}
        </select>
        {e.batch && <p className="field-error" role="alert">{e.batch}</p>}
      </div>
      <Field
        label="Password"
        name="password"
        type="password"
        error={e.password}
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={128}
        hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number."
      />
      <Field label="Confirm password" name="confirmPassword" type="password" error={clientError ?? e.confirmPassword} autoComplete="new-password" required />
      <SubmitButton pending="Creating account…">Create account</SubmitButton>
      <p className="muted">
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
