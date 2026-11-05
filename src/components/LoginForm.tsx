"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAdminAction, loginStudentAction, type FormState } from "@/app/actions/auth";
import { Alert, Field, SubmitButton } from "./ui";

export default function LoginForm({ portal }: { portal: "student" | "admin" }) {
  const [state, action] = useActionState<FormState, FormData>(portal === "admin" ? loginAdminAction : loginStudentAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action}>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <Field label="Email" name="email" type="email" defaultValue={state.values?.email} error={e.email} autoComplete="username" required />
      <Field label="Password" name="password" type="password" error={e.password} autoComplete="current-password" required />
      <SubmitButton pending="Logging in…">Log in</SubmitButton>
      {portal === "student" && (
        <p className="muted">
          No account? <Link href="/register">Register</Link> · <Link href="/resend-verification">Resend verification email</Link>
        </p>
      )}
    </form>
  );
}
