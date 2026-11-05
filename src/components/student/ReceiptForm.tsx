"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { submitReceiptAction, type SubmitState } from "@/app/actions/student";
import { Alert } from "@/components/ui";
import { formatDate } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { PAYMENT_METHODS } from "@/lib/payments/validation";

export interface EligibleInstallment {
  obligationId: string;
  label: string;
  amountCents: number;
  dueDate: string;
}

const TYPES = ["image/png", "image/jpeg"];

export default function ReceiptForm(props: { studentName: string; studentId: string; installments: EligibleInstallment[]; selectedId?: string; today: string; maxMb: number }) {
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitReceiptAction, {});
  const [obligationId, setObligationId] = useState(props.selectedId ?? props.installments[0]?.obligationId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const chosen = props.installments.find((i) => i.obligationId === obligationId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = formRef.current!;
    const fd = new FormData(form);
    const file = (form.elements.namedItem("receipt") as HTMLInputElement).files?.[0];
    if (!obligationId) return setError("Select an installment.");
    if (!fd.get("paymentDate")) return setError("Enter the payment date.");
    if (!fd.get("paymentMethod")) return setError("Select a payment method.");
    if (!file) return setError("Attach your receipt screenshot.");
    if (!TYPES.includes(file.type)) return setError("The receipt must be a PNG or JPEG image.");
    if (file.size === 0) return setError("The selected file is empty.");
    if (file.size > props.maxMb * 1024 * 1024) return setError(`The receipt is too large. The limit is ${props.maxMb} MB.`);

    setBusy(true);
    try {
      // 1) ask the server for a short-lived upload authorization for THIS installment
      const res = await fetch("/api/receipts/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obligationId }) });
      const intent = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(intent.error ?? "Could not start the upload.");
      // 2) upload the bytes straight to private storage
      if (intent.mode === "blob") {
        const { upload } = await import("@vercel/blob/client");
        await upload(intent.storageKey, file, { access: "private", handleUploadUrl: "/api/receipts/blob-token", clientPayload: intent.intentId, contentType: file.type });
      } else {
        const up = await fetch(`/api/receipts/upload/${intent.intentId}`, { method: "PUT", body: file });
        if (!up.ok) throw new Error((await up.json().catch(() => ({}))).error ?? "The upload failed. Please try again.");
      }
      // 3) submit the form data; the server re-verifies the stored object before saving
      const out = new FormData();
      out.set("obligationId", obligationId);
      out.set("intentId", intent.intentId);
      out.set("paymentDate", String(fd.get("paymentDate")));
      out.set("paymentMethod", String(fd.get("paymentMethod")));
      out.set("referenceNumber", String(fd.get("referenceNumber") ?? ""));
      startTransition(() => formAction(out));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (props.installments.length === 0) {
    return <div className="card"><p>You have no installments that can accept a receipt right now. Paid installments and installments awaiting review are not shown.</p></div>;
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      {(error || state.message) && <Alert kind="error">{error ?? state.message}</Alert>}
      <div className="field"><label>Student</label><input className="readonly" readOnly value={`${props.studentName} (${props.studentId})`} aria-readonly="true" /></div>
      <div className="field">
        <label htmlFor="obligationId">Installment</label>
        <select id="obligationId" value={obligationId} onChange={(e) => setObligationId(e.target.value)} required>
          {props.installments.map((i) => <option key={i.obligationId} value={i.obligationId}>{i.label} - due {formatDate(i.dueDate)}</option>)}
        </select>
      </div>
      {/* Display only: no name attribute, so it is never submitted. The server uses the installment's own amount. */}
      <div className="field"><label htmlFor="amountDue">Amount due</label><input id="amountDue" className="readonly" readOnly value={chosen ? formatPeso(chosen.amountCents) : ""} aria-readonly="true" /></div>
      <div className="field"><label htmlFor="paymentDate">Payment date</label><input id="paymentDate" name="paymentDate" type="date" max={props.today} required /></div>
      <div className="field">
        <label htmlFor="paymentMethod">Payment method</label>
        <select id="paymentMethod" name="paymentMethod" defaultValue="" required>
          <option value="" disabled>Select…</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="referenceNumber">Transaction reference number (recommended)</label>
        <input id="referenceNumber" name="referenceNumber" maxLength={60} autoComplete="off" />
        <small>Enter it if your receipt shows one. It helps verify your payment faster.</small>
      </div>
      <div className="field">
        <label htmlFor="receipt">Receipt screenshot (PNG or JPEG, up to {props.maxMb} MB)</label>
        <input id="receipt" name="receipt" type="file" accept="image/png,image/jpeg" required />
      </div>
      <button id="submitReceipt" className="btn" type="submit" disabled={busy || pending} aria-busy={busy || pending}>
        {(busy || pending) && <span className="button-spinner" aria-hidden="true" />}
        <span>{busy ? "Uploading receipt…" : pending ? "Saving submission…" : "Submit receipt"}</span>
      </button>
    </form>
  );
}
