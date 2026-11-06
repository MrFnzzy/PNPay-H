"use client";

import { useActionState, useState } from "react";
import { createBatchPlanAction, createScheduleAction, deleteBatchPlanAction, deleteObligationAction, updateBatchPlanAction, updateObligationAction, type AdminFormState } from "@/app/actions/admin";
import { Alert, SubmitButton } from "@/components/ui";
import { batchOptionLabel, PLAN_MONTHS } from "@/lib/batches";

const initial: AdminFormState = {};

/** Months from the start month to the end month, both included (display only; the server re-validates). */
function monthsBetween(a: string, b: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
}
/** Same day of the month, n months later (clamped to the month's last day). */
function addMonthsISO(date: string, n: number) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1, d = Number(date.slice(8, 10));
  const idx = m + n, yy = y + Math.floor(idx / 12), mm = idx % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function CreatePlanForm({ standardAmount, defaultFirstDue, batches }: { standardAmount: string; defaultFirstDue: string; batches: string[] }) {
  const [state, action] = useActionState(createBatchPlanAction, initial);
  const [first, setFirst] = useState(defaultFirstDue);
  const [last, setLast] = useState(addMonthsISO(defaultFirstDue, PLAN_MONTHS - 1));
  const count = monthsBetween(first, last);
  return (
    <form action={action} className="card" aria-label="Create batch plan">
      <h2 className="section" style={{ marginTop: 0 }}>Create a payment plan for a batch</h2>
      <p className="muted">Each batch pays up to {PLAN_MONTHS} monthly installments (2 years) and has its own start and end. No student can ever hold more than {PLAN_MONTHS} installments in total. Pick the batch, then the first and last due date; one installment is created for every month in between, on the same day of the month. The plan is saved for the batch: students already in it receive it now, and every student who registers into this batch later receives it automatically.</p>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <div className="grid-2">
        <div className="field"><label htmlFor="planBatch">Batch</label><select id="planBatch" name="batch" defaultValue={batches[0]}>{batches.map((b) => <option key={b} value={b}>{batchOptionLabel(b)}</option>)}</select></div>
        <div className="field"><label htmlFor="firstDueDate">Start: first due date</label><input id="firstDueDate" name="firstDueDate" type="date" value={first} onChange={(e) => { setFirst(e.target.value); if (e.target.value) setLast(addMonthsISO(e.target.value, PLAN_MONTHS - 1)); }} required /></div>
        <div className="field"><label htmlFor="lastDueDate">End: last due date</label><input id="lastDueDate" name="lastDueDate" type="date" value={last} onChange={(e) => setLast(e.target.value)} required /><small>{count >= 1 ? `${count} monthly installment${count === 1 ? "" : "s"} (maximum ${PLAN_MONTHS}).` : "The end must not be before the start."}</small></div>
        <div className="field"><label htmlFor="planAmount">Amount per month (₱)</label><input id="planAmount" name="amount" inputMode="decimal" defaultValue={standardAmount} required /><small>Standard monthly installment is ₱{standardAmount}.</small></div>
        <div className="field"><label htmlFor="planAmountNote">Note for a non-standard amount</label><input id="planAmountNote" name="amountNote" maxLength={300} /></div>
      </div>
      <p className="muted">Existing installments are skipped, so saving again never duplicates anything. Saving a new plan for a batch replaces the plan used for future registrations.</p>
      <SubmitButton pending="Creating plan…">{count >= 1 ? `Create ${count}-month plan` : "Create plan"}</SubmitButton>
    </form>
  );
}

export function EditBatchPlanForm({ batch, firstDueDate, lastDueDate, amount, amountNote, standardAmount, students }: { batch: string; firstDueDate: string; lastDueDate: string; amount: string; amountNote: string; standardAmount: string; students: number }) {
  const [state, action] = useActionState(updateBatchPlanAction, initial);
  const [first, setFirst] = useState(firstDueDate);
  const [last, setLast] = useState(lastDueDate);
  const count = monthsBetween(first, last);
  return (
    <form action={action} className="card" aria-label="Edit batch plan">
      <h2 className="section" style={{ marginTop: 0 }}>Edit plan</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="batch" value={batch} />
      <div className="grid-2">
        <div className="field"><label htmlFor="editFirstDue">Start: first due date</label><input id="editFirstDue" name="firstDueDate" type="date" value={first} onChange={(e) => { setFirst(e.target.value); if (e.target.value) setLast(addMonthsISO(e.target.value, Math.max(count, 1) - 1)); }} required /></div>
        <div className="field"><label htmlFor="editLastDue">End: last due date</label><input id="editLastDue" name="lastDueDate" type="date" value={last} onChange={(e) => setLast(e.target.value)} required /><small>{count >= 1 ? `${count} monthly installment${count === 1 ? "" : "s"} (maximum ${PLAN_MONTHS}).` : "The end must not be before the start."}</small></div>
        <div className="field"><label htmlFor="editPlanAmount">Amount per month (₱)</label><input id="editPlanAmount" name="amount" inputMode="decimal" defaultValue={amount} required /><small>Standard monthly installment is ₱{standardAmount}.</small></div>
        <div className="field"><label htmlFor="editPlanNote">Note for a non-standard amount</label><input id="editPlanNote" name="amountNote" maxLength={300} defaultValue={amountNote} /></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 .5rem" }}>
        <input type="checkbox" name="applyToStudents" defaultChecked style={{ minHeight: 0, marginTop: 3 }} />
        <span>Also update the {students} student{students === 1 ? "" : "s"} already in this batch</span>
      </label>
      <p className="muted">
        The saved plan always changes for future registrations. When the box is ticked, each student’s installments from the old plan are moved to the new dates and amount, installments outside the new range are removed, and any new months are added. Installments that have a receipt (pending, rejected or paid), are being uploaded, or were edited individually are never changed.
      </p>
      <SubmitButton pending="Saving plan…">Save plan</SubmitButton>
    </form>
  );
}

export function DeleteBatchPlanForm({ batch, students }: { batch: string; students: number }) {
  const [state, action] = useActionState(deleteBatchPlanAction, initial);
  return (
    <form
      id="delete"
      action={action}
      onSubmit={(e) => {
        const remove = (e.currentTarget.elements.namedItem("removeInstallments") as HTMLInputElement | null)?.checked;
        const msg = remove
          ? `Delete the Batch ${batch} plan AND remove its unpaid installments from the ${students} student(s) already in the batch? Installments with receipts are kept. This cannot be undone.`
          : `Delete the Batch ${batch} plan? New registrations will no longer receive it. Installments already given to students stay as they are. This cannot be undone.`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
      className="card danger-zone"
      aria-label="Delete batch plan"
    >
      <h2 className="section" style={{ marginTop: 0 }}>Delete plan</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="batch" value={batch} />
      <p className="muted">Deleting the plan stops it from being given to students who register into this batch later. The deletion is recorded in the audit history.</p>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 1rem" }}>
        <input type="checkbox" name="removeInstallments" style={{ minHeight: 0, marginTop: 3 }} />
        <span>Also remove this plan’s installments from the {students} student{students === 1 ? "" : "s"} already in the batch (only installments with no receipts that were never edited individually)</span>
      </label>
      <SubmitButton className="btn btn-danger" pending="Deleting…">Delete plan</SubmitButton>
    </form>
  );
}

export function CreateScheduleForm({ standardAmount, defaultYear, batches }: { standardAmount: string; defaultYear: string; batches: string[] }) {
  const [state, action] = useActionState(createScheduleAction, initial);
  const [scope, setScope] = useState("all");
  return (
    <form action={action} className="card" aria-label="Create installment">
      <h2 className="section" style={{ marginTop: 0 }}>Create an installment</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <div className="grid-2">
        <div className="field"><label htmlFor="academicYear">Academic year</label><input id="academicYear" name="academicYear" defaultValue={defaultYear} placeholder="2026-2027" required /></div>
        <div className="field"><label htmlFor="periodLabel">Installment period</label><input id="periodLabel" name="periodLabel" placeholder="November 2026" maxLength={50} required /></div>
        <div className="field"><label htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" required /></div>
        <div className="field"><label htmlFor="amount">Amount (₱)</label><input id="amount" name="amount" inputMode="decimal" defaultValue={standardAmount} required /><small>Standard monthly installment is ₱{standardAmount}.</small></div>
      </div>
      <div className="field"><label htmlFor="amountNote">Note for a non-standard amount</label><input id="amountNote" name="amountNote" maxLength={300} /><small>Required only when the amount is not ₱{standardAmount}: record the approved requirement.</small></div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="scope">Assign to</label>
          <select id="scope" name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All active students</option>
            <option value="batch">One batch</option>
            <option value="student">One student</option>
          </select>
        </div>
        {scope === "batch" && (
          <div className="field"><label htmlFor="batch">Batch</label><select id="batch" name="batch" defaultValue={batches[0]}>{batches.map((b) => <option key={b} value={b}>{batchOptionLabel(b)}</option>)}</select></div>
        )}
        {scope === "student" && <div className="field"><label htmlFor="studentCode">Student ID</label><input id="studentCode" name="studentCode" maxLength={30} /></div>}
      </div>
      <p className="muted">Students who already have this period for the academic year are skipped, never duplicated.</p>
      <SubmitButton pending="Creating installment…">Create installment</SubmitButton>
    </form>
  );
}

export function EditObligationForm(props: {
  obligationId: string;
  academicYear: string;
  periodLabel: string;
  dueDate: string;
  amount: string;
  standardAmount: string;
  canEditAmount: boolean;
  canEditDueDate: boolean;
  canEditPeriod: boolean;
}) {
  const [state, action] = useActionState(updateObligationAction, initial);
  const anyEditable = props.canEditAmount || props.canEditDueDate || props.canEditPeriod;
  return (
    <form action={action} className="card" aria-label="Edit installment">
      <h2 className="section" style={{ marginTop: 0 }}>Edit installment</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <input type="hidden" name="obligationId" value={props.obligationId} />
      <div className="grid-2">
        {/* Locked fields are still sent (read-only) so the server compares them; the server enforces the locks. */}
        <div className="field"><label htmlFor="academicYear">Academic year</label><input id="academicYear" name="academicYear" defaultValue={props.academicYear} readOnly={!props.canEditPeriod} className={props.canEditPeriod ? "" : "readonly"} /></div>
        <div className="field"><label htmlFor="periodLabel">Installment period</label><input id="periodLabel" name="periodLabel" defaultValue={props.periodLabel} readOnly={!props.canEditPeriod} className={props.canEditPeriod ? "" : "readonly"} /></div>
        <div className="field"><label htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" defaultValue={props.dueDate} readOnly={!props.canEditDueDate} className={props.canEditDueDate ? "" : "readonly"} /></div>
        <div className="field"><label htmlFor="amount">Amount (₱)</label><input id="amount" name="amount" inputMode="decimal" defaultValue={props.amount} readOnly={!props.canEditAmount} className={props.canEditAmount ? "" : "readonly"} /></div>
      </div>
      {props.canEditAmount && <div className="field"><label htmlFor="amountNote">Note for a non-standard amount</label><input id="amountNote" name="amountNote" maxLength={300} /><small>Required when the new amount is not ₱{props.standardAmount}.</small></div>}
      {anyEditable && <SubmitButton pending="Saving changes…">Save changes</SubmitButton>}
    </form>
  );
}

export function DeleteObligationForm({ obligationId, periodLabel, paid, receipts }: { obligationId: string; periodLabel: string; paid: boolean; receipts: number }) {
  const [state, action] = useActionState(deleteObligationAction, initial);
  const message = paid
    ? `Delete ${periodLabel}? It is PAID: the verified payment and its receipt will be deleted too. This cannot be undone.`
    : receipts > 0
      ? `Delete ${periodLabel}? Its ${receipts} submitted receipt(s) will be deleted too. This cannot be undone.`
      : `Delete the ${periodLabel} installment? This cannot be undone.`;
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(message)) e.preventDefault(); }} className="card danger-zone" aria-label="Remove installment">
      <h2 className="section" style={{ marginTop: 0 }}>Remove installment</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <p className="muted">
        {paid
          ? "This installment is Paid. Removing it also deletes the verified payment and its receipt."
          : receipts > 0
            ? `Removing it also deletes its ${receipts} submitted receipt${receipts === 1 ? "" : "s"}.`
            : "Removes this installment from the student's schedule."}{" "}
        The removal is recorded in the audit history (the review decisions are kept).
      </p>
      <input type="hidden" name="obligationId" value={obligationId} />
      <SubmitButton className="btn btn-danger" pending="Removing…">Remove installment</SubmitButton>
    </form>
  );
}
