import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { BATCHES, BATCH_LABEL, isBatch } from "@/lib/batches";
import { listStudentSummaries } from "@/lib/admin/records";

export const metadata = { title: "Students" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function StudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, unread } = await loadAdmin();
  const params = await searchParams;
  const deleted = first(params.deleted);
  const q = first(params.q)?.trim() || undefined;
  const batchParam = first(params.batch);
  const batch = batchParam && isBatch(batchParam) ? batchParam : undefined;
  const students = await listStudentSummaries(q, batch);
  return <AdminPage name={user.fullName} unread={unread}>
    {deleted && <div className="alert alert-success" role="status">The student account and its payment records were deleted.</div>}
    <div className="directory-heading"><div><span className="eyebrow">Admin workspace / directory</span><h1>Students</h1><p className="muted">Select a student to see payments, paid months, and upcoming months. The list stays intentionally compact.</p></div><span className="directory-count">{students.length} student{students.length === 1 ? "" : "s"}</span></div>
    <form method="get" action="/admin/students" className="card directory-filters" aria-label="Search students">
      <div className="field"><label htmlFor="student-search">Search by name or student ID</label><input id="student-search" name="q" defaultValue={q ?? ""} placeholder="e.g. Maria Santos or 2024-001" /></div>
      <div className="field"><label htmlFor="student-batch">Year / batch</label><select id="student-batch" name="batch" defaultValue={batch ?? ""}><option value="">All batches</option>{BATCHES.map((b) => <option key={b} value={b}>{BATCH_LABEL[b]}</option>)}</select></div>
      <div className="row directory-actions"><button className="btn" type="submit">Search students</button><Link className="btn btn-secondary" href="/admin/students">Clear</Link></div>
    </form>
    <div className="student-list" aria-label="Student list">
      {students.length === 0 ? <div className="card empty-state"><span className="empty-state-icon">⌕</span><strong>No students found</strong><p className="muted">Try a different name, student ID, or batch.</p></div> : students.map((student) => <Link key={student.userId} href={`/admin/students/${student.userId}`} className="student-list-row"><span className="student-avatar">{student.fullName.slice(0, 1).toUpperCase()}</span><span className="student-main"><strong>{student.fullName}</strong><small>{student.studentId ?? "No student ID"}{student.course ? ` · ${student.course}` : ""}</small></span><span className="student-meta"><strong>{student.installmentCount}</strong><small>scheduled payment{student.installmentCount === 1 ? "" : "s"}</small></span><span className={`account-state ${student.isActive ? "active" : "inactive"}`}>{student.isActive ? "Active" : "Inactive"}</span><span className="student-arrow" aria-hidden="true">→</span></Link>)}
    </div>
  </AdminPage>;
}
