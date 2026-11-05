"use client";

import { useActionState, useState } from "react";
import { createBatchPlanAction, createScheduleAction, deleteObligationAction, updateObligationAction, type AdminFormState } from "@/app/actions/admin";
import { Alert, SubmitButton } from "@/components/ui";
import { BATCHES, BATCH_LABEL, PLAN_MONTHS } from "@/lib/batches";

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

export function CreatePlanForm({ standardAmount, defaultFirstDue }: { standardAmount: string; defaultFirstDue: string }) {
  const [state, action] = useActionState(createBatchPlanAction, initial);
  const [first, setFirst] = useState(defaultFirstDue);
  const [last, setLast] = useState(addMonthsISO(defaultFirstDue, PLAN_MONTHS - 1));
  const count = monthsBetween(first, last);
  return (
    <form action={action} className="card" aria-label="Create batch plan">
      <h2 className="section" style={{ marginTop: 0 }}>Create a payment plan for a batch</h2>
      <p className="muted">Each batch pays up to {PLAN_MONTHS} monthly installments (2 years) and has its own start and end. Pick the batch, then the first and last due date; one installment is created for every month in between, on the same day of the month.</p>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <div className="grid-2">
        <div className="field"><label htmlFor="planBatch">Batch</label><select id="planBatch" name="batch" defaultValue="2026">{BATCHES.map((b) => <option key={b} value={b}>{BATCH_LABEL[b]}</option>)}</select></div>
        <div className="field"><label htmlFor="firstDueDate">Start: first due date</label><input id="firstDueDate" name="firstDueDate" type="date" value={first} onChange={(e) => { setFirst(e.target.value); if (e.target.value) setLast(addMonthsISO(e.target.value, PLAN_MONTHS - 1)); }} required /></div>
        <div className="field"><label htmlFor="lastDueDate">End: last due date</label><input id="lastDueDate" name="lastDueDate" type="date" value={last} onChange={(e) => setLast(e.target.value)} required /><small>{count >= 1 ? `${count} monthly installment${count === 1 ? "" : "s"} (maximum ${PLAN_MONTHS}).` : "The end must not be before the start."}</small></div>
        <div className="field"><label htmlFor="planAmount">Amount per month (₱)</label><input id="planAmount" name="amount" inputMode="decimal" defaultValue={standardAmount} required /><small>Standard monthly installment is ₱{standardAmount}.</small></div>
        <div className="field"><label htmlFor="planAmountNote">Note for a non-standard amount</label><input id="planAmountNote" name="amountNote" maxLength={300} /></div>
      </div>
      <p className="muted">Existing installments are skipped, so running this again also covers students of that batch who registered later.</p>
      <SubmitButton pending="Creating plan…">{count >= 1 ? `Create ${count}-month plan` : "Create plan"}</SubmitButton>
    </form>
  );
}

export function CreateScheduleForm({ standardAmount, defaultYear }: { standardAmount: string; defaultYear: string }) {
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
          <div className="field"><label htmlFor="batch">Batch</label><select id="batch" name="batch" defaultValue="2026">{BATCHES.map((b) => <option key={b} value={b}>{BATCH_LABEL[b]}</option>)}</select></div>
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

export function DeleteObligationForm({ obligationId }: { obligationId: string }) {
  const [state, action] = useActionState(deleteObligationAction, initial);
  return (
    <form action={action} className="card" aria-label="Remove installment">
      <h2 className="section" style={{ marginTop: 0 }}>Remove installment</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <p className="muted">Only an installment with no receipts can be removed (for example, one created by mistake). The removal is recorded.</p>
      <input type="hidden" name="obligationId" value={obligationId} />
      <SubmitButton className="btn btn-danger" pending="Removing…">Remove installment</SubmitButton>
    </form>
  );
}
