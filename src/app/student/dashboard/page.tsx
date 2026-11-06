import Link from "next/link";
import PaymentCalendar from "@/components/student/PaymentCalendar";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { SubmissionPill } from "@/components/student/StatusPill";
import { formatDateTime, manilaToday } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { getDashboard } from "@/lib/payments/queries";
import { paymentMethodLabel } from "@/lib/payments/validation";

export const metadata = { title: "Student dashboard" };
export const dynamic = "force-dynamic";

function monthLabel(m: string) {
  return new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" });
}

export default async function StudentDashboard() {
  const { user } = await loadStudent({ includeUnread: false });
  const today = manilaToday();
  const d = await getDashboard(user.userId, today);
  const calendarItems = d.installments.map((i) => ({
    obligationId: i.obligationId,
    periodLabel: i.periodLabel,
    amountCents: i.amountCents,
    dueDate: i.dueDate,
    status: i.status,
  }));
  return (
    <StudentPage name={user.fullName} unread={d.unreadNotifications}>
      <h1>Welcome, {user.fullName}</h1>
      <p className="muted">Student ID: {user.studentId}</p>

      {d.unreadNotifications > 0 && (
        <p>
          You have <Link href="/student/notifications">{d.unreadNotifications} unread notification{d.unreadNotifications === 1 ? "" : "s"}</Link>.
        </p>
      )}

      {d.installmentCount === 0 ? (
        <div className="card">
          <p>No payment schedule has been set up for your account yet. Your installments will appear here once the administrator adds them.</p>
        </div>
      ) : null}

      <div className="stats">
        <div className="stat"><div className="label">Total counterpart fee</div><div className="value">{formatPeso(d.totalCents)}</div></div>
        <div className="stat"><div className="label">Total verified payments</div><div className="value">{formatPeso(d.paidCents)}</div></div>
        <div className="stat"><div className="label">Remaining balance</div><div className="value">{formatPeso(d.remainingCents)}</div></div>
        <div className="stat"><div className="label">Overdue installments</div><div className="value">{d.overdueCount}</div></div>
      </div>

      <div className="card">
        <div className="row"><strong>Payment progress</strong><span className="spacer" /><span>{d.progressPercent}%</span></div>
        <div className="progress" role="progressbar" aria-valuenow={d.progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Payment progress">
          <span style={{ width: `${d.progressPercent}%` }} />
        </div>
        <p className="muted">Only verified payments count. Receipts that are pending review are not counted until they are verified.</p>
      </div>

      <h2 className="section">Monthly payment calendar</h2>
      {calendarItems.length === 0 ? <p className="muted">No payment months have been scheduled yet.</p> : <PaymentCalendar items={calendarItems} today={today} />}

      <h2 className="section">Monthly payment overview</h2>
      {d.monthly.length === 0 ? (
        <p className="muted">Nothing scheduled yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Month</th><th>Due</th><th>Verified paid</th><th>Progress</th></tr></thead>
            <tbody>
              {d.monthly.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td>{formatPeso(m.dueCents)}</td>
                  <td>{formatPeso(m.paidCents)}</td>
                  <td style={{ minWidth: 120 }}>
                    <div className="progress" aria-hidden="true"><span style={{ width: `${m.dueCents ? Math.round((m.paidCents / m.dueCents) * 100) : 0}%` }} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p><Link href="/student/tracker">Open the full payment tracker</Link> · <Link href="/student/calendar">Open the calendar</Link></p>

      <h2 className="section">Recent transactions</h2>
      {d.recent.length === 0 ? (
        <p className="muted">You have not submitted any receipts yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Submitted</th><th>Installment</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {d.recent.map((t) => (
                <tr key={t.submissionId}>
                  <td>{formatDateTime(t.submittedAt)}</td><td>{t.periodLabel}</td><td>{formatPeso(t.amountCents)}</td><td>{paymentMethodLabel(t.paymentMethod)}</td><td><SubmissionPill status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p><Link href="/student/history">View full payment history</Link></p>
    </StudentPage>
  );
}
