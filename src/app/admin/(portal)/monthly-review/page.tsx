import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { listRecords } from "@/lib/admin/records";

export const metadata = { title: "Monthly Payment Review" };
export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthKey = (index: number) => `${new Date().getFullYear()}-${String(index + 1).padStart(2, "0")}`;

export default async function MonthlyReview() {
  const { user, unread } = await loadAdmin();
  const currentMonth = new Date().getMonth();
  const monthData = await Promise.all(MONTHS.map(async (name, index) => {
    const res = await listRecords({ month: monthKey(index), sort: "due_date", dir: "asc", page: 1 });
    const verified = res.rows.filter((row) => row.installmentStatus === "paid").length;
    const pending = res.rows.filter((row) => row.installmentStatus === "pending_verification").length;
    return { name, key: monthKey(index), total: res.total, verified, pending, isCurrent: index === currentMonth };
  }));
  return <AdminPage name={user.fullName} unread={unread}>
    <div className="review-intro"><div><span className="eyebrow">Admin workspace / review</span><h1>Monthly Payment Review</h1><p>See the year at a glance, then jump into the existing payment records for a closer review. No new data flow is introduced here.</p></div><Link className="btn btn-secondary" href="/admin/records">View all records</Link></div>
    <div className="month-grid">
      {monthData.map((month) => {
        const state = month.isCurrent ? "current" : month.total === 0 ? "future" : month.pending > 0 ? "review" : month.verified === month.total ? "complete" : "review";
        return <Link key={month.key} href={`/admin/records?month=${month.key}&sort=due_date&dir=asc`} className={`month-tile ${state}`} aria-label={`Open ${month.name} payment records`}><strong>{month.name}{month.isCurrent ? " · Now" : ""}</strong><small>{month.total === 0 ? "No scheduled payments" : `${month.verified} verified · ${month.pending} to review`}</small></Link>;
      })}
    </div>
    <div className="card"><div className="row"><strong>At-a-glance status</strong><span className="spacer" /><span className="pill s-pending_review">Needs review</span><span className="pill s-verified">Complete</span></div><p className="muted">Colors summarize the current records. Select any month to use the existing filters, sorting, and receipt review actions.</p></div>
  </AdminPage>;
}
