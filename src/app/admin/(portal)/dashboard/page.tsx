import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { InstallmentPill, SubmissionPill } from "@/components/student/StatusPill";
import { countEmailsNeedingAttention } from "@/lib/email/queue";
import { getAdminDashboard, UPCOMING_WINDOW_DAYS, type RecordRow } from "@/lib/admin/records";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Admin dashboard" };
export const dynamic = "force-dynamic";

function InstallmentTable({ rows, empty }: { rows: RecordRow[]; empty: string }) {
  if (rows.length === 0) return <div className="card"><p className="muted">{empty}</p></div>;
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th>Student</th><th>Installment</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.obligationId}>
              <td><Link href={`/admin/students/${r.studentId}`}>{r.studentName}</Link><br /><small>{r.studentCode}</small></td>
              <td>{r.periodLabel}<br /><small>{r.academicYear}</small></td>
              <td>{formatPeso(r.amountCents)}</td>
              <td>{formatDate(r.dueDate)}</td>
              <td><InstallmentPill status={r.installmentStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminDashboard() {
  const { user, unread } = await loadAdmin();
  const [d, latest, emailProblems] = await Promise.all([
    getAdminDashboard(),
    getNotifications(user.userId, 5),
    countEmailsNeedingAttention(),
  ]);
  const q = (s: string) => `/admin/records?submission=${s}&sort=submission_date&dir=desc`;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Administrator dashboard</h1>
      <div className="stats">
        <div className="stat"><div className="label">Total submissions</div><div className="value">{d.totalSubmissions}</div></div>
        <div className="stat"><div className="label"><Link href={q("pending_review")}>Pending receipt reviews</Link></div><div className="value">{d.pending}</div></div>
        <div className="stat"><div className="label"><Link href={q("verified")}>Verified submissions</Link></div><div className="value">{d.verified}</div></div>
        <div className="stat"><div className="label"><Link href={q("needs_correction")}>Needing correction</Link></div><div className="value">{d.needsCorrection}</div></div>
        <div className="stat"><div className="label"><Link href={q("rejected")}>Rejected submissions</Link></div><div className="value">{d.rejected}</div></div>
        <div className="stat"><div className="label"><Link href="/admin/records">Student payment records</Link></div><div className="value">{d.installments}</div><small>{d.students} student{d.students === 1 ? "" : "s"}</small></div>
        <div className="stat"><div className="label">Overdue installments</div><div className="value">{d.overdueCount}</div></div>
        <div className="stat"><div className="label">Unread notifications</div><div className="value">{unread}</div></div>
        <div className="stat"><div className="label"><Link href="/admin/email">Emails needing attention</Link></div><div className="value">{emailProblems}</div></div>
      </div>

      <h2 className="section">Receipts waiting for review</h2>
      {d.pendingQueue.length === 0 ? (
        <div className="card"><p className="muted">No receipts are waiting for review.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Student</th><th>Installment</th><th>Submitted</th><th></th></tr></thead>
            <tbody>
              {d.pendingQueue.map((p) => (
                <tr key={p.submissionId}>
                  <td>{p.studentName}<br /><small>{p.studentCode}</small></td>
                  <td>{p.periodLabel}</td>
                  <td>{formatDateTime(p.submittedAt)}</td>
                  <td><Link href={`/admin/submissions/${p.submissionId}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Overdue installments ({d.overdueCount})</h2>
      <InstallmentTable rows={d.overdue} empty="No installments are overdue." />

      <h2 className="section">Upcoming deadlines (next {UPCOMING_WINDOW_DAYS} days, {d.upcomingCount})</h2>
      <InstallmentTable rows={d.upcoming} empty="No unpaid installments are due in this period." />

      <h2 className="section">Recent submission activity</h2>
      {d.recent.length === 0 ? (
        <div className="card"><p className="muted">No receipts have been submitted yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Submitted</th><th>Student</th><th>Installment</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.submissionId}>
                  <td>{formatDateTime(r.submittedAt)}</td>
                  <td>{r.studentName}<br /><small>{r.studentCode}</small></td>
                  <td>{r.periodLabel}</td>
                  <td><SubmissionPill status={r.status} />{r.reviewedAt && <><br /><small>Reviewed {formatDateTime(r.reviewedAt)}</small></>}</td>
                  <td><Link href={`/admin/submissions/${r.submissionId}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Latest notifications</h2>
      {latest.length === 0 ? (
        <div className="card"><p className="muted">No notifications yet.</p></div>
      ) : (
        latest.map((n) => (
          <div key={n.notificationId} className={`notif${n.isRead ? "" : " unread"}`}>
            <strong>{n.title}</strong> <small>{formatDateTime(n.createdAt)}</small>
            <div>{n.message}</div>
            {n.submissionId && <Link href={`/admin/submissions/${n.submissionId}`}>Open submission</Link>}
          </div>
        ))
      )}
      <p><Link href="/admin/notifications">All notifications</Link></p>
    </AdminPage>
  );
}
