"use client";

import { useActionState } from "react";
import { resendAction, type FormState } from "@/app/actions/auth";
import { Alert, Field, SubmitButton } from "./ui";

export default function ResendForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, action] = useActionState<FormState, FormData>(resendAction, {});
  return (
    <form action={action}>
      {state.message && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <Field label="Email" name="email" type="email" defaultValue={state.values?.email ?? defaultEmail} error={state.fieldErrors?.email} autoComplete="email" required />
      <SubmitButton pending="Sending…">Send verification email</SubmitButton>
    </form>
  );
}
