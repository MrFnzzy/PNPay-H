"use client";

import { useActionState, useState } from "react";
import { createScheduleAction, deleteObligationAction, updateObligationAction, type AdminFormState } from "@/app/actions/admin";
import { Alert } from "@/components/ui";

const initial: AdminFormState = {};

export function CreateScheduleForm({ standardAmount, defaultYear }: { standardAmount: string; defaultYear: string }) {
  const [state, action, pending] = useActionState(createScheduleAction, initial);
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
            <option value="year_level">One year level</option>
            <option value="student">One student</option>
          </select>
        </div>
        {scope === "year_level" && (
          <div className="field"><label htmlFor="yearLevel">Year level</label><select id="yearLevel" name="yearLevel" defaultValue="1">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Year {n}</option>)}</select></div>
        )}
        {scope === "student" && <div className="field"><label htmlFor="studentCode">Student ID</label><input id="studentCode" name="studentCode" maxLength={30} /></div>}
      </div>
      <p className="muted">Students who already have this period for the academic year are skipped, never duplicated.</p>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : "Create installment"}</button>
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
  const [state, action, pending] = useActionState(updateObligationAction, initial);
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
      {anyEditable && <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>}
    </form>
  );
}

export function DeleteObligationForm({ obligationId }: { obligationId: string }) {
  const [state, action, pending] = useActionState(deleteObligationAction, initial);
  return (
    <form action={action} className="card" aria-label="Remove installment">
      <h2 className="section" style={{ marginTop: 0 }}>Remove installment</h2>
      {state.message && <Alert kind="error">{state.message}</Alert>}
      <p className="muted">Only an installment with no receipts can be removed (for example, one created by mistake). The removal is recorded.</p>
      <input type="hidden" name="obligationId" value={obligationId} />
      <button className="btn btn-danger" type="submit" disabled={pending}>Remove installment</button>
    </form>
  );
}
