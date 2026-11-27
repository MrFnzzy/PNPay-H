import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { listBatchPlans, listScheduleGroups } from "@/lib/admin/schedules";
import { batchLabel } from "@/lib/batches";
import { getBatchOptions } from "@/lib/batch-window";
import { CreatePlanForm, CreateScheduleForm } from "@/components/admin/ScheduleForms";
import { Alert } from "@/components/ui";
import Link from "next/link";
import { formatDate, manilaToday } from "@/lib/payments/dates";
import { formatPeso, STANDARD_INSTALLMENT_AMOUNT } from "@/lib/payments/money";

export const metadata = { title: "Payment schedules" };
export const dynamic = "force-dynamic";

const range = (a: string, b: string, f: (x: string) => string) => (a === b ? f(a) : `${f(a)} – ${f(b)}`);

export default async function Schedules({ searchParams }: { searchParams: Promise<{ created?: string; skipped?: string; removed?: string; plan?: string; full?: string; planSaved?: string; planUpdated?: string; planRemoved?: string; planCreated?: string; planKept?: string; planDeleted?: string }> }) {
  const { user, unread } = await loadAdmin();
  const sp = await searchParams;
  const [groups, plans, batches] = await Promise.all([listScheduleGroups(), listBatchPlans(), getBatchOptions()]);
  const year = Number(manilaToday().slice(0, 4));
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Payment schedules</h1>
      {sp.created && (
        <Alert kind="success">
          {sp.plan ? `${Number(sp.created)} installments created (${Number(sp.plan)}-month plan).` : `Installment created for ${Number(sp.created)} student${Number(sp.created) === 1 ? "" : "s"}.`}
          {Number(sp.skipped) > 0 && ` ${Number(sp.skipped)} already existed and were skipped.`}
          {Number(sp.full) > 0 && ` ${Number(sp.full)} were not created because those students already have the maximum of 24 installments.`}
        </Alert>
      )}
      {sp.removed && <Alert kind="success">The installment was removed.</Alert>}
      {sp.planSaved && (
        <Alert kind="success">
          Batch plan saved ({Number(sp.planSaved)} months).
          {(Number(sp.planUpdated) > 0 || Number(sp.planRemoved) > 0 || Number(sp.planCreated) > 0) && ` Students: ${Number(sp.planUpdated)} updated, ${Number(sp.planRemoved)} removed, ${Number(sp.planCreated)} added.`}
          {Number(sp.planKept) > 0 && ` ${Number(sp.planKept)} installment${Number(sp.planKept) === 1 ? " was" : "s were"} left unchanged (receipt, upload in progress, or edited individually).`}
        </Alert>
      )}
      {sp.planDeleted && (
        <Alert kind="success">
          The batch plan was deleted.
          {Number(sp.planRemoved) > 0 && ` ${Number(sp.planRemoved)} student installment${Number(sp.planRemoved) === 1 ? " was" : "s were"} removed.`}
          {Number(sp.planKept) > 0 && ` ${Number(sp.planKept)} installment${Number(sp.planKept) === 1 ? " was" : "s were"} kept (receipt, upload in progress, or edited individually).`}
        </Alert>
      )}
      <CreatePlanForm standardAmount={STANDARD_INSTALLMENT_AMOUNT} defaultFirstDue={`${year}-01-15`} batches={batches} />
      {plans.length > 0 && (
        <>
          <h2 className="section">Saved batch plans (given automatically to new registrations)</h2>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Batch</th><th>First due</th><th>Last due</th><th>Months</th><th>Amount</th><th>Students now</th><th></th></tr></thead>
              <tbody>{plans.map((p) => <tr key={p.batch}><td>{batchLabel(p.batch)}</td><td>{formatDate(p.firstDueDate)}</td><td>{formatDate(p.lastDueDate)}</td><td>{p.months}</td><td>₱{p.amount}</td><td>{p.students}</td><td style={{ whiteSpace: "nowrap" }}><Link className="btn btn-secondary btn-small" href={`/admin/schedules/plan/${encodeURIComponent(p.batch)}`}>Edit</Link>{" "}<Link className="btn btn-danger btn-small" href={`/admin/schedules/plan/${encodeURIComponent(p.batch)}#delete`}>Delete</Link></td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <CreateScheduleForm standardAmount={STANDARD_INSTALLMENT_AMOUNT} defaultYear={`${year}-${year + 1}`} batches={batches} />

      <h2 className="section">Existing installment periods</h2>
      {groups.length === 0 ? (
        <div className="card"><p className="muted">No installments have been created yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Academic year</th><th>Period</th><th>Due date</th><th>Amount</th><th>Students</th><th>Paid</th><th></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.academicYear}|${g.periodLabel.toLowerCase()}`}>
                  <td>{g.academicYear}</td>
                  <td>{g.periodLabel}</td>
                  <td>{range(g.dueFrom, g.dueTo, formatDate)}</td>
                  <td>{range(String(g.amountFromCents), String(g.amountToCents), (c) => formatPeso(Number(c)))}</td>
                  <td>{g.students}</td>
                  <td>{g.paid}</td>
                  <td><Link href={`/admin/records?month=${g.dueFrom.slice(0, 7)}`}>View records</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">To edit or remove one student’s installment, open it from <Link href="/admin/records">Student records</Link> (“Schedule”).</p>
    </AdminPage>
  );
}
