import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { InstallmentPill, SubmissionPill } from "@/components/student/StatusPill";
import { Alert } from "@/components/ui";
import { INSTALLMENT_FILTERS, listRecords, parseRecordFilters, SORTS, SUBMISSION_FILTERS, type RecordFilters } from "@/lib/admin/records";
import { batchLabel, batchOptionLabel } from "@/lib/batches";
import { getBatchOptions } from "@/lib/batch-window";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { INSTALLMENT_LABEL, SUBMISSION_LABEL } from "@/lib/payments/status";

export const metadata = { title: "Student payment records" };
export const dynamic = "force-dynamic";

const SORT_LABEL = { due_date: "Due date", student_name: "Student name", submission_date: "Submission date" } as const;

function qs(f: RecordFilters, over: Partial<Record<string, string | number | undefined>> = {}) {
  const p = new URLSearchParams();
  const base: Record<string, string | number | undefined> = { q: f.q, batch: f.batch, month: f.month, payFrom: f.payFrom, payTo: f.payTo, submission: f.submission, installment: f.installment, sort: f.sort, dir: f.dir, page: f.page, ...over };
  for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

export default async function Records({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, unread } = await loadAdmin();
  const batchOptions = await getBatchOptions();
  const { filters: f, errors } = parseRecordFilters(await searchParams);
  const res = await listRecords(f);
  const sortLink = (col: (typeof SORTS)[number]) => `/admin/records?${qs(f, { sort: col, dir: f.sort === col && f.dir === "asc" ? "desc" : "asc", page: 1 })}`;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Student payment records</h1>
      {errors.length > 0 && <Alert kind="error">Some filters were ignored: {errors.join(" ")}</Alert>}
      {/* A plain GET form: filtering and sorting only ever READ data. */}
      <form method="get" action="/admin/records" className="card" aria-label="Filters">
        <div className="filters">
          <div className="field"><label htmlFor="q">Student name or ID</label><input id="q" name="q" defaultValue={f.q ?? ""} maxLength={100} /></div>
          <div className="field">
            <label htmlFor="batch">Batch</label>
            <select id="batch" name="batch" defaultValue={f.batch ?? ""}>
              <option value="">Any</option>
              {batchOptions.map((b) => <option key={b} value={b}>{batchOptionLabel(b)}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="month">Due month</label><input id="month" name="month" type="month" defaultValue={f.month ?? ""} /></div>
          <div className="field"><label htmlFor="payFrom">Payment date from</label><input id="payFrom" name="payFrom" type="date" defaultValue={f.payFrom ?? ""} /></div>
          <div className="field"><label htmlFor="payTo">Payment date to</label><input id="payTo" name="payTo" type="date" defaultValue={f.payTo ?? ""} /></div>
          <div className="field">
            <label htmlFor="submission">Receipt status</label>
            <select id="submission" name="submission" defaultValue={f.submission ?? ""}>
              <option value="">Any</option>
              {SUBMISSION_FILTERS.map((s) => <option key={s} value={s}>{s === "none" ? "No receipt submitted" : SUBMISSION_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="installment">Installment status</label>
            <select id="installment" name="installment" defaultValue={f.installment ?? ""}>
              <option value="">Any</option>
              {INSTALLMENT_FILTERS.map((s) => <option key={s} value={s}>{INSTALLMENT_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={f.sort}>{SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="dir">Order</label>
            <select id="dir" name="dir" defaultValue={f.dir}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
          </div>
        </div>
        <div className="row"><button className="btn" type="submit">Apply filters</button><Link className="btn btn-secondary" href="/admin/records">Clear</Link></div>
      </form>

      <p className="muted" role="status">{res.total} record{res.total === 1 ? "" : "s"} found.</p>
      {res.total === 0 ? (
        <div className="card"><p>No records match these filters.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th><Link href={sortLink("student_name")}>Student</Link></th>
                <th>Batch</th>
                <th>Installment</th>
                <th>Amount</th>
                <th><Link href={sortLink("due_date")}>Due date</Link></th>
                <th>Installment status</th>
                <th>Latest receipt</th>
                <th><Link href={sortLink("submission_date")}>Submitted</Link></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.obligationId}>
                  <td><Link href={`/admin/students/${r.studentId}`}>{r.studentName}</Link><br /><small>{r.studentCode}</small></td>
                  <td>{batchLabel(r.batch)}</td>
                  <td>{r.periodLabel}<br /><small>{r.academicYear}</small></td>
                  <td>{formatPeso(r.amountCents)}</td>
                  <td>{formatDate(r.dueDate)}</td>
                  <td><InstallmentPill status={r.installmentStatus} /></td>
                  <td>{r.submissionStatus ? <SubmissionPill status={r.submissionStatus} /> : <span className="muted">None</span>}{r.paymentDate && <><br /><small>Paid {formatDate(r.paymentDate)}</small></>}</td>
                  <td>{r.submittedAt ? formatDateTime(r.submittedAt) : <span className="muted">—</span>}</td>
                  <td>
                    {r.submissionId && <Link href={`/admin/submissions/${r.submissionId}`}>{r.submissionStatus === "pending_review" ? "Review" : "Open"}</Link>}
                    {r.submissionId && <br />}
                    <Link href={`/admin/schedules/${r.obligationId}`}>Schedule</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.pages > 1 && (
        <p className="row">
          {res.page > 1 && <Link href={`/admin/records?${qs(f, { page: res.page - 1 })}`}>← Previous</Link>}
          <span className="muted">Page {res.page} of {res.pages}</span>
          {res.page < res.pages && <Link href={`/admin/records?${qs(f, { page: res.page + 1 })}`}>Next →</Link>}
        </p>
      )}
    </AdminPage>
  );
}
