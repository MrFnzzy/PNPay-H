import Link from "next/link";
import { batchLabel } from "@/lib/batches";
import { notFound } from "next/navigation";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import DeleteSubmissionButton from "@/components/admin/DeleteSubmissionButton";
import ReviewForm from "@/components/admin/ReviewForm";
import { InstallmentPill, SubmissionPill } from "@/components/student/StatusPill";
import { Alert } from "@/components/ui";
import { DECISION_LABEL, getSubmissionDetails, REMARKS_MIN, type ReviewDecision } from "@/lib/admin/review";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { paymentMethodLabel } from "@/lib/payments/validation";

export const metadata = { title: "Review receipt" };
export const dynamic = "force-dynamic";

export default async function SubmissionPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ reviewed?: string; deleteError?: string }> }) {
  const { user, unread } = await loadAdmin();
  const { submissionId } = await params;
  const sp = await searchParams;
  const s = await getSubmissionDetails(submissionId);
  if (!s) notFound();
  const reviewed = sp.reviewed && sp.reviewed in DECISION_LABEL ? (sp.reviewed as ReviewDecision) : null;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <p><Link href="/admin/records?submission=pending_review&sort=submission_date">← Review queue</Link></p>
      <h1>Review receipt</h1>
      {reviewed && <Alert kind="success">Decision saved: {DECISION_LABEL[reviewed]}. The student was notified in the portal; the email is queued.</Alert>}
      {sp.deleteError && <Alert kind="error">This payment could not be deleted. Only submissions still pending review can be removed; reviewed payments are retained for audit history.</Alert>}
      <div className="split">
        <div className="card">
          <dl className="facts">
            <dt>Student</dt><dd><Link href={`/admin/students/${s.studentId}`}>{s.studentName}</Link></dd>
            <dt>Student ID</dt><dd>{s.studentCode}</dd>
            <dt>Batch</dt><dd>{batchLabel(s.batch)}{s.course ? ` · ${s.course}` : ""}</dd>
            <dt>Installment</dt><dd>{s.periodLabel} ({s.academicYear})</dd>
            <dt>Due date</dt><dd>{formatDate(s.dueDate)}</dd>
            <dt>Amount due</dt><dd>{formatPeso(s.amountDueCents)}</dd>
            <dt>Payment date</dt><dd>{formatDate(s.paymentDate)}</dd>
            <dt>Payment method</dt><dd>{paymentMethodLabel(s.paymentMethod)}</dd>
            <dt>Transaction reference</dt><dd>{s.referenceNumber ?? <span className="muted">Not provided</span>}</dd>
            <dt>Submitted</dt><dd>{formatDateTime(s.submittedAt)}</dd>
            <dt>Receipt status</dt><dd><SubmissionPill status={s.status} /></dd>
            <dt>Installment status</dt><dd><InstallmentPill status={s.installmentStatus} /></dd>
            {s.reviewedAt && (<><dt>Reviewed</dt><dd>{formatDateTime(s.reviewedAt)}</dd></>)}
            {s.remarks && (<><dt>Remarks</dt><dd>{s.remarks}</dd></>)}
          </dl>
        </div>
        <div className="card">
          <h2 className="section" style={{ marginTop: 0 }}>Receipt screenshot</h2>
          {/* Served only by the authorized route; the browser sends the admin session cookie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="receipt-frame" src={`/api/receipts/${s.submissionId}`} alt={`Receipt submitted by ${s.studentName} for ${s.periodLabel}`} />
          <p><a href={`/api/receipts/${s.submissionId}`} target="_blank" rel="noopener noreferrer">Open full size</a> <small>({s.receiptMime === "image/png" ? "PNG" : "JPEG"}, {Math.max(1, Math.round(s.receiptSize / 1024))} KB)</small></p>
        </div>
      </div>

      {s.canReview ? (
        <><ReviewForm submissionId={s.submissionId} remarksMin={REMARKS_MIN} /><div className="delete-submission-panel"><DeleteSubmissionButton submissionId={s.submissionId} /></div></>
      ) : (
        <div className="card"><p>This receipt has already been reviewed ({s.status === "verified" ? "verified payments cannot be changed" : "the student replaces it with a new submission"}).</p></div>
      )}

      <h2 className="section">Submission history for this installment</h2>
      {s.history.map((h) => (
        <div key={h.submissionId} className={`history-item${h.submissionId === s.submissionId ? " current" : ""}`}>
          <div>
            <SubmissionPill status={h.status} /> submitted {formatDateTime(h.submittedAt)} · paid {formatDate(h.paymentDate)} via {paymentMethodLabel(h.paymentMethod)}{h.referenceNumber ? ` · ref ${h.referenceNumber}` : ""}
            {h.submissionId === s.submissionId ? " (this receipt)" : <> · <Link href={`/admin/submissions/${h.submissionId}`}>open</Link></>}
          </div>
          {h.review && (
            <small>
              {DECISION_LABEL[h.review.decision]} by {h.review.adminName} on {formatDateTime(h.review.reviewedAt)}
              {h.review.remarks ? ` — “${h.review.remarks}”` : ""}
            </small>
          )}
        </div>
      ))}
    </AdminPage>
  );
}
