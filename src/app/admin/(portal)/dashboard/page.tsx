import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { SubmissionPill } from "@/components/student/StatusPill";
import { countEmailsNeedingAttention } from "@/lib/email/queue";
import { getAdminDashboard, getBatchCalendars, type BatchCalendar } from "@/lib/admin/records";
import { batchLabel } from "@/lib/batches";
import { formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Admin dashboard" };
export const dynamic = "force-dynamic";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (m: string) => `${SHORT_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const STATUS_LABEL = { paid: "Paid", due: "Due", "not-due": "To be paid" } as const;

/** Month-card calendar for every student, one section per batch. */
function BatchCalendars({ batches }: { batches: BatchCalendar[] }) {
  if (batches.length === 0) return <div className="card"><p className="muted">No students yet.</p></div>;
  return (
    <>
      {batches.map((b) => (
        <section key={b.batch ?? "none"} className="card batch-calendar" aria-label={b.batch ? batchLabel(b.batch) : "No batch"}>
          <div className="row">
            <div>
              <span className="eyebrow">{b.batch ? batchLabel(b.batch) : "No batch"}</span>
              <strong>{b.students.length} student{b.students.length === 1 ? "" : "s"}</strong>
            </div>
            <span className="spacer" />
            <div className="batch-totals"><span className="paid">{b.paidMonths} paid</span><span className="due">{b.dueMonths} due</span><span className="not-due">{b.toBePaidMonths} to be paid</span></div>
          </div>
          <div className="batch-students">
            {b.students.map((s) => (
              <div key={s.studentId} className="student-calendar">
                <div className="row">
                  <div><Link href={`/admin/students/${s.studentId}`}><strong>{s.fullName}</strong></Link><br /><small>{s.studentCode ?? "—"}</small></div>
                  <span className="spacer" />
                  <div className="batch-totals"><span className="paid">{s.paidMonths} paid</span><span className="due">{s.dueMonths} due</span><span className="not-due">{s.toBePaidMonths} to be paid</span></div>
                </div>
                {s.months.length === 0 ? (
                  <p className="muted">No months scheduled.</p>
                ) : (
                  <div className="mini-calendar">
                    {s.months.map((m) => (
                      <div key={m.month} className={`admin-month-chip ${m.status}`} title={`${monthShort(m.month)}: ${STATUS_LABEL[m.status]} (${m.paid}/${m.total} paid)`}>
                        <strong>{monthShort(m.month)}</strong>
                        <small>{STATUS_LABEL[m.status]}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default async function AdminDashboard() {
  const { user, unread } = await loadAdmin();
  const [d, latest, emailProblems, calendars] = await Promise.all([
    getAdminDashboard(),
    getNotifications(user.userId, 5),
    countEmailsNeedingAttention(),
    getBatchCalendars(),
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

      <h2 className="section">Payment calendar by batch</h2>
      <p className="muted">Each student's months at a glance: green is paid, red is due now, yellow is still to be paid.</p>
      <BatchCalendars batches={calendars} />

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
