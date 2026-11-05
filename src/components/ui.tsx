"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  error?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}) {
  const { label, name, error, hint, ...rest } = props;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} aria-invalid={!!error} aria-describedby={error ? `${name}-err` : undefined} {...rest} />
      {hint && !error && <small>{hint}</small>}
      {error && (
        <p id={`${name}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children, pending: label }: { children: ReactNode; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending}>
      {pending ? (label ?? "Please wait…") : children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
