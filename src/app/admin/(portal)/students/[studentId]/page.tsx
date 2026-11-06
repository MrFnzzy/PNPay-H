import Link from "next/link";
import { batchLabel } from "@/lib/batches";
import DeleteStudentForm from "@/components/admin/DeleteStudentForm";
import DeleteInstallmentButton from "@/components/admin/DeleteInstallmentButton";
import DeleteSubmissionButton from "@/components/admin/DeleteSubmissionButton";
import { trimInstallmentsAction } from "@/app/actions/admin";
import { Alert, SubmitButton } from "@/components/ui";
import { MAX_INSTALLMENTS_PER_STUDENT } from "@/lib/batches";
import { notFound } from "next/navigation";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { InstallmentPill, SubmissionPill } from "@/components/student/StatusPill";
import { getStudentHeader } from "@/lib/admin/records";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { getDashboard, getPaymentHistory } from "@/lib/payments/queries";
import { paymentMethodLabel } from "@/lib/payments/validation";

export const metadata = { title: "Student record" };
export const dynamic = "force-dynamic";

function monthTitle(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** Administrator view of one student. The id from the URL is validated and must belong to a STUDENT account. */
export default async function StudentRecord({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ page?: string; removed?: string; deleted?: string; deleteError?: string; installmentError?: string; trimmed?: string; kept?: string }> }) {
  const { user, unread } = await loadAdmin();
  const { studentId } = await params;
  const student = await getStudentHeader(studentId);
  if (!student) notFound();
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10);
  const [d, h] = await Promise.all([getDashboard(student.userId), getPaymentHistory(student.userId, Number.isFinite(page) ? page : 1)]);
  const returnTo = `/admin/students/${student.userId}`;
  const total = d.installments.length;
  const monthSummary = Array.from(d.installments.reduce((map, installment) => {
    const month = installment.dueDate.slice(0, 7);
    const current = map.get(month) ?? { total: 0, paid: 0, due: 0 };
    current.total += 1;
    if (installment.status === "paid") current.paid += 1;
    if (installment.status !== "paid" && installment.dueDate <= new Date().toISOString().slice(0, 10)) current.due += 1;
    map.set(month, current);
    return map;
  }, new Map<string, { total: number; paid: number; due: number }>()).entries()).sort(([a], [b]) => a.localeCompare(b));
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <p><Link href="/admin/records">← Student records</Link></p>
      <h1>{student.fullName}</h1>
      <p className="muted">Student ID {student.studentId} · {batchLabel(student.batch)}{student.course ? ` · ${student.course}` : ""}{student.isActive ? "" : " · Account deactivated"}</p>
      {sp.removed && <Alert kind="success">The installment was deleted and the deletion was recorded.</Alert>}
      {sp.deleted && <Alert kind="success">The payment was deleted. The installment is back on the schedule as unpaid.</Alert>}
      {sp.trimmed && <Alert kind="success">{Number(sp.trimmed)} extra installment{Number(sp.trimmed) === 1 ? "" : "s"} removed.{Number(sp.kept) > 0 ? ` ${Number(sp.kept)} extra installment${Number(sp.kept) === 1 ? " has" : "s have"} receipts and ${Number(sp.kept) === 1 ? "was" : "were"} left in place; delete ${Number(sp.kept) === 1 ? "it" : "them"} one by one if you are sure.` : ""}</Alert>}
      {sp.deleteError && <Alert kind="error">{sp.deleteError === "schema" ? "The database needs a one-time update before verified payments can be deleted, and the app could not apply it itself. Run `npm run db:migrate` once, then try again." : "That payment could not be deleted. Nothing was changed."}</Alert>}
      {sp.installmentError && <Alert kind="error">{sp.installmentError === "uploading" ? "The student is uploading a receipt for that installment right now. Try again in a few minutes." : "That could not be completed. Nothing was changed."}</Alert>}
      {total > MAX_INSTALLMENTS_PER_STUDENT ? (
        <div className="card danger-zone">
          <strong>{total} installments scheduled — the limit is {MAX_INSTALLMENTS_PER_STUDENT}.</strong>
          <p className="muted">Delete the extra {total - MAX_INSTALLMENTS_PER_STUDENT} below, or remove them all at once. This keeps the {MAX_INSTALLMENTS_PER_STUDENT} earliest due dates and deletes the later ones that have no receipts.</p>
          <form action={trimInstallmentsAction}>
            <input type="hidden" name="studentUserId" value={student.userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton className="btn btn-danger" pending="Removing…">Remove the extra {total - MAX_INSTALLMENTS_PER_STUDENT}</SubmitButton>
          </form>
        </div>
      ) : (
        <p className="muted">{total} of {MAX_INSTALLMENTS_PER_STUDENT} installments scheduled.</p>
      )}
      <div className="card admin-student-overview"><div className="row"><div><span className="eyebrow">Payment overview</span><strong>Months to be paid and paid</strong></div><span className="spacer" /><Link className="btn btn-secondary" href="/admin/students">← All students</Link></div><div className="admin-month-summary">{monthSummary.length === 0 ? <p className="muted">No months have been scheduled for this student.</p> : monthSummary.map(([month, summary]) => { const status = summary.paid === summary.total ? "paid" : summary.due > 0 ? "due" : "not-due"; return <div key={month} className={`admin-month-chip ${status}`}><strong>{monthTitle(month)}</strong><span>{summary.paid}/{summary.total} paid</span><small>{summary.due > 0 ? `${summary.due} due` : status === "paid" ? "Complete" : "Not due"}</small></div>; })}</div></div>
      <div className="stats">
        <div className="stat"><div className="label">Total counterpart fee</div><div className="value">{formatPeso(d.totalCents)}</div></div>
        <div className="stat"><div className="label">Total verified payments</div><div className="value">{formatPeso(d.paidCents)}</div></div>
        <div className="stat"><div className="label">Remaining balance</div><div className="value">{formatPeso(d.remainingCents)}</div></div>
        <div className="stat"><div className="label">Overdue installments</div><div className="value">{d.overdueCount}</div></div>
      </div>
      <h2 className="section">Installments</h2>
      {d.installments.length === 0 ? (
        <div className="card"><p className="muted">No installments are scheduled for this student.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Installment</th><th>Amount</th><th>Due</th><th>Status</th><th>Latest receipt</th><th></th></tr></thead>
            <tbody>
              {d.installments.map((i) => (
                <tr key={i.obligationId}>
                  <td>{i.periodLabel}<br /><small>{i.academicYear}</small></td>
                  <td>{formatPeso(i.amountCents)}</td>
                  <td>{formatDate(i.dueDate)}</td>
                  <td><InstallmentPill status={i.status} /></td>
                  <td>{i.latestSubmission ? <SubmissionPill status={i.latestSubmission.status} /> : <span className="muted">None</span>}</td>
                  <td>
                    {i.latestSubmission && <Link href={`/admin/submissions/${i.latestSubmission.submissionId}`}>Open receipt</Link>}
                    {i.latestSubmission && <br />}
                    <Link href={`/admin/schedules/${i.obligationId}`}>Schedule</Link>
                    <div style={{ marginTop: 6 }}><DeleteInstallmentButton obligationId={i.obligationId} periodLabel={i.periodLabel} returnTo={returnTo} paid={i.status === "paid"} receipts={Boolean(i.latestSubmission)} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="section">Submission history</h2>
      {h.total === 0 ? (
        <div className="card"><p className="muted">No receipts have been submitted.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Submitted</th><th>Installment</th><th>Amount</th><th>Method / reference</th><th>Status</th><th>Remarks</th><th></th></tr></thead>
            <tbody>
              {h.rows.map((r) => (
                <tr key={r.submissionId}>
                  <td>{formatDateTime(r.submittedAt)}</td>
                  <td>{r.periodLabel}</td>
                  <td>{formatPeso(r.amountCents)}</td>
                  <td>{paymentMethodLabel(r.paymentMethod)}<br /><small>{r.referenceNumber ?? "No reference"}</small></td>
                  <td><SubmissionPill status={r.status} /></td>
                  <td>{r.remarks ?? <span className="muted">—</span>}</td>
                  <td>
                    <Link href={`/admin/submissions/${r.submissionId}`}>Open</Link>
                    {(r.status === "verified" || r.status === "pending_review") && <div style={{ marginTop: 6 }}><DeleteSubmissionButton submissionId={r.submissionId} status={r.status} returnTo={returnTo} compact /></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DeleteStudentForm studentUserId={student.userId} studentCode={student.studentId ?? ""} name={student.fullName} />
      {h.pages > 1 && (
        <p className="row">
          {h.page > 1 && <Link href={`/admin/students/${student.userId}?page=${h.page - 1}`}>← Newer</Link>}
          <span className="muted">Page {h.page} of {h.pages}</span>
          {h.page < h.pages && <Link href={`/admin/students/${student.userId}?page=${h.page + 1}`}>Older →</Link>}
        </p>
      )}
    </AdminPage>
  );
}
