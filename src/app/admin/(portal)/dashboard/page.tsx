import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { SubmissionPill } from "@/components/student/StatusPill";
import { countEmailsNeedingAttention } from "@/lib/email/queue";
import { getAdminDashboard, getBatchCalendars, type BatchCalendar, type StudentCalendar } from "@/lib/admin/records";
import { getBatchOptions } from "@/lib/batch-window";
import { batchLabel, batchOptionLabel } from "@/lib/batches";
import { formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Admin dashboard" };
export const dynamic = "force-dynamic";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (m: string) => `${SHORT_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const STATUS_LABEL = { paid: "Paid", due: "Due", "not-due": "To be paid" } as const;

const NO_BATCH = "none";
const tabHref = (batch: string, student?: string) => `/admin/dashboard?batch=${batch}${student ? `&student=${student}` : ""}#payment-calendar`;

function Totals({ paid, due, toBePaid }: { paid: number; due: number; toBePaid: number }) {
  return <div className="batch-totals"><span className="paid">{paid} paid</span><span className="due">{due} due</span><span className="not-due">{toBePaid} to be paid</span></div>;
}

function StudentMonths({ s }: { s: StudentCalendar }) {
  return (
    <div className="student-calendar">
      <div className="row">
        <div><Link href={`/admin/students/${s.studentId}`}><strong>{s.fullName}</strong></Link><br /><small>{s.studentCode ?? "—"}</small></div>
        <span className="spacer" />
        <Totals paid={s.paidMonths} due={s.dueMonths} toBePaid={s.toBePaidMonths} />
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
  );
}

/** Batch tabs (2026 | 2027 | 2028 ...), the students of the chosen batch as small cards, and the chosen student's month calendar. */
function BatchCalendars({ calendars, tabs, batchParam, studentParam }: { calendars: BatchCalendar[]; tabs: string[]; batchParam?: string; studentParam?: string }) {
  const keyOf = (b: string | null) => b ?? NO_BATCH;
  const byKey = new Map(calendars.map((c) => [keyOf(c.batch), c]));
  const allTabs = [...tabs, ...calendars.filter((c) => !tabs.includes(keyOf(c.batch))).map((c) => keyOf(c.batch))];
  if (allTabs.length === 0) return <div className="card"><p className="muted">No students yet.</p></div>;
  const selected = batchParam && allTabs.includes(batchParam) ? batchParam : (allTabs.find((t) => (byKey.get(t)?.students.length ?? 0) > 0) ?? allTabs[0]);
  const current = byKey.get(selected);
  const students = current?.students ?? [];
  const chosen = students.find((st) => st.studentId === studentParam);
  return (
    <section className="card batch-calendar" id="payment-calendar" aria-label="Payment calendar by batch">
      <nav className="batch-tabs" aria-label="Batches">
        {allTabs.map((t) => (
          <Link key={t} href={tabHref(t)} className={`batch-tab${t === selected ? " active" : ""}`} aria-current={t === selected ? "page" : undefined}>
            {t === NO_BATCH ? "No batch" : batchOptionLabel(t)} <small>{byKey.get(t)?.students.length ?? 0}</small>
          </Link>
        ))}
      </nav>
      {current && students.length > 0 && <div className="row" style={{ marginTop: 12 }}><strong>{selected === NO_BATCH ? "No batch" : batchLabel(selected)}</strong><span className="spacer" /><Totals paid={current.paidMonths} due={current.dueMonths} toBePaid={current.toBePaidMonths} /></div>}
      {students.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>No students in this batch yet.</p>
      ) : (
        <div className="student-cards">
          {students.map((st) => (
            <Link key={st.studentId} href={tabHref(selected, st.studentId)} className={`student-card${st.studentId === chosen?.studentId ? " active" : ""}`} aria-current={st.studentId === chosen?.studentId ? "true" : undefined}>
              <strong>{st.fullName}</strong>
              <span className="paid-count">{st.paidMonths} paid</span>
              <small>{st.dueMonths} due · {st.toBePaidMonths} to be paid</small>
            </Link>
          ))}
        </div>
      )}
      {students.length > 0 && (chosen ? <StudentMonths s={chosen} /> : <p className="muted" style={{ marginTop: 14 }}>Select a student to see their month-by-month calendar.</p>)}
    </section>
  );
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ batch?: string; student?: string }> }) {
  const sp = await searchParams;
  const { user, unread } = await loadAdmin();
  const [d, latest, emailProblems, calendars, batchOptions] = await Promise.all([
    getAdminDashboard(),
    getNotifications(user.userId, 5),
    countEmailsNeedingAttention(),
    getBatchCalendars(),
    getBatchOptions(),
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
      <p className="muted">Pick a batch, then a student, to see their months: green is paid, red is due now, yellow is still to be paid.</p>
      <BatchCalendars calendars={calendars} tabs={batchOptions} batchParam={sp.batch} studentParam={sp.student} />

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
