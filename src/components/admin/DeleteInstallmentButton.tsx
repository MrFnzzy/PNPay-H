"use client";

import { deleteInstallmentAction } from "@/app/actions/admin";
import { SubmitButton } from "@/components/ui";

/** Inline "Delete" for one installment on the student record. Warns louder when receipts / a verified payment will go with it. */
export default function DeleteInstallmentButton({ obligationId, periodLabel, returnTo, paid, receipts }: { obligationId: string; periodLabel: string; returnTo: string; paid: boolean; receipts: boolean }) {
  const message = paid
    ? `Delete ${periodLabel}? It is PAID: the verified payment and its receipt will be deleted too. The deletion is recorded in the audit history. This cannot be undone.`
    : receipts
      ? `Delete ${periodLabel}? Its submitted receipt(s) will be deleted too. This cannot be undone.`
      : `Delete the ${periodLabel} installment? This cannot be undone.`;
  return (
    <form action={deleteInstallmentAction} onSubmit={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      <input type="hidden" name="obligationId" value={obligationId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton className="btn btn-danger btn-small" pending="Deleting…">Delete</SubmitButton>
    </form>
  );
}
