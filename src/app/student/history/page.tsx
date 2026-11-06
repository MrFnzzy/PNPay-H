import Link from "next/link";
import { z } from "zod";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { SubmissionPill } from "@/components/student/StatusPill";
import { Alert } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { getPaymentHistory } from "@/lib/payments/queries";
import { paymentMethodLabel } from "@/lib/payments/validation";

export const metadata = { title: "Payment history" };
export const dynamic = "force-dynamic";

export default async function History({ searchParams }: { searchParams: Promise<{ page?: string; submitted?: string }> }) {
  const { user, unread } = await loadStudent();
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? "1", 10);
  const h = await getPaymentHistory(user.userId, Number.isFinite(page) ? page : 1);
  const justSubmitted = z.string().uuid().safeParse(sp.submitted).success;
  return (
    <StudentPage name={user.fullName} unread={unread}>
      <h1>Payment history</h1>
      {justSubmitted && <Alert kind="success">Your receipt was submitted and is pending review. It is not counted as paid until it is verified.</Alert>}
      {h.total === 0 ? (
        <div className="card"><p>You have not submitted any receipts yet. <Link href="/student/submit">Submit a receipt</Link></p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr><th>Submitted</th><th>Installment</th><th>Amount</th><th>Payment date</th><th>Method / reference</th><th>Status</th><th>Remarks</th><th>Receipt</th></tr>
            </thead>
            <tbody>
              {h.rows.map((r) => (
                <tr key={r.submissionId} id={`s-${r.submissionId}`}>
                  <td>{formatDateTime(r.submittedAt)}</td>
                  <td>{r.periodLabel}<br /><small>{r.academicYear}</small></td>
                  <td>{formatPeso(r.amountCents)}</td>
                  <td>{formatDate(r.paymentDate)}</td>
                  <td>{paymentMethodLabel(r.paymentMethod)}<br /><small>{r.referenceNumber ?? "No reference"}</small></td>
                  <td><SubmissionPill status={r.status} /></td>
                  <td>{r.remarks ?? <span className="muted">—</span>}</td>
                  <td>
                    <a href={`/api/receipts/${r.submissionId}`} target="_blank" rel="noopener noreferrer">View</a>
                    <br /><small>{r.receiptMime === "image/png" ? "PNG" : "JPEG"}, {Math.max(1, Math.round(r.receiptSize / 1024))} KB</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {h.pages > 1 && (
        <p className="row">
          {h.page > 1 && <Link href={`/student/history?page=${h.page - 1}`}>← Newer</Link>}
          <span className="muted">Page {h.page} of {h.pages}</span>
          {h.page < h.pages && <Link href={`/student/history?page=${h.page + 1}`}>Older →</Link>}
        </p>
      )}
    </StudentPage>
  );
}
