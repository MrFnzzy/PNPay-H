import Link from "next/link";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { InstallmentPill, SubmissionPill } from "@/components/student/StatusPill";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { getInstallments } from "@/lib/payments/queries";
import { isSubmittable } from "@/lib/payments/status";

export const metadata = { title: "Payment tracker" };
export const dynamic = "force-dynamic";

export default async function Tracker() {
  const { user, unread } = await loadStudent();
  const items = await getInstallments(user.userId);
  return (
    <StudentPage name={user.fullName} unread={unread}>
      <h1>Monthly payment tracker</h1>
      {items.length === 0 ? (
        <div className="card"><p>No installments have been scheduled for you yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Period</th><th>Amount due</th><th>Due date</th><th>Installment status</th><th>Latest receipt</th><th /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.obligationId} id={`o-${i.obligationId}`}>
                  <td>{i.periodLabel}<br /><small>{i.academicYear}</small></td>
                  <td>{formatPeso(i.amountCents)}</td>
                  <td>{formatDate(i.dueDate)}</td>
                  <td><InstallmentPill status={i.status} /></td>
                  <td>
                    {i.latestSubmission ? (
                      <>
                        <SubmissionPill status={i.latestSubmission.status} /><br />
                        <small>{formatDateTime(i.latestSubmission.submittedAt)}</small>
                        {i.latestSubmission.remarks && <><br /><small>Remarks: {i.latestSubmission.remarks}</small></>}
                      </>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>{isSubmittable(i.status) && <Link href={`/student/submit?obligation=${i.obligationId}`}>Submit receipt</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Installment status and receipt status are different: a receipt that is pending, rejected or needs correction never counts as paid.</p>
    </StudentPage>
  );
}
