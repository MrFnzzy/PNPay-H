import Link from "next/link";
import { batchLabel } from "@/lib/batches";
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

/** Administrator view of one student. The id from the URL is validated and must belong to a STUDENT account. */
export default async function StudentRecord({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { user, unread } = await loadAdmin();
  const { studentId } = await params;
  const student = await getStudentHeader(studentId);
  if (!student) notFound();
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10);
  const [d, h] = await Promise.all([getDashboard(student.userId), getPaymentHistory(student.userId, Number.isFinite(page) ? page : 1)]);
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <p><Link href="/admin/records">← Student records</Link></p>
      <h1>{student.fullName}</h1>
      <p className="muted">Student ID {student.studentId} · {batchLabel(student.batch)}{student.course ? ` · ${student.course}` : ""}{student.isActive ? "" : " · Account deactivated"}</p>
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
                  <td><Link href={`/admin/submissions/${r.submissionId}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
