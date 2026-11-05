"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyEmailAction, type VerifyState } from "@/app/actions/auth";
import { Alert, SubmitButton } from "./ui";

const messages = {
  verified: { kind: "success", text: "Your email is verified. You can now log in." },
  already_verified: { kind: "success", text: "This email is already verified. You can log in." },
  expired: { kind: "error", text: "This verification link has expired. Request a new one below." },
  used: { kind: "error", text: "This verification link was already used. Request a new one below if needed." },
  invalid: { kind: "error", text: "This verification link is not valid. Request a new one below." },
} as const;

export default function VerifyEmailPanel({ token }: { token: string }) {
  const [state, action] = useActionState<VerifyState, FormData>(verifyEmailAction, {});
  if (state.outcome) {
    const m = messages[state.outcome];
    const good = state.outcome === "verified" || state.outcome === "already_verified";
    return (
      <>
        <Alert kind={m.kind}>{m.text}</Alert>
        <p>{good ? <Link className="btn" href="/login">Go to login</Link> : <Link className="btn" href="/resend-verification">Request a new link</Link>}</p>
      </>
    );
  }
  // Verification happens on button press (POST), so email scanners that pre-open links cannot consume the token.
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <p>Confirm that you want to verify this email address for PNPay-H.</p>
      <SubmitButton pending="Verifying…">Verify my email</SubmitButton>
    </form>
  );
}
