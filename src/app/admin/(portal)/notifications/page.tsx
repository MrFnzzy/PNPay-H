import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { approveBatchRolloverAction, markAdminNotificationReadAction, markAllAdminNotificationsReadAction } from "@/app/actions/admin";
import { listPendingBatchRolloverProposals } from "@/lib/admin/batches";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ rolloverApproved?: string; rolloverError?: string }> }) {
  const { user, unread } = await loadAdmin();
  const items = await getNotifications(user.userId); // scoped to the session administrator
  const proposals = await listPendingBatchRolloverProposals();
  const sp = await searchParams;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Notifications</h1>
      {sp.rolloverApproved && <div className="alert success">Batch rollover approved. Affected students are now marked Alumni; payment history was preserved.</div>}
      {sp.rolloverError && <div className="alert error">That batch rollover could not be approved. It may already have been handled.</div>}
      {proposals.length > 0 && <section className="card rollover-panel"><span className="eyebrow">Approval required</span><h2 className="section">Batch rollover proposals</h2><p className="muted">The system detected cohorts that completed their 30-month window. No student was changed yet.</p>{proposals.map((proposal) => <div className="rollover-proposal" key={proposal.proposalId}><div><strong>Batch {proposal.fromBatch} → Alumni</strong><small>{proposal.affectedStudents} student{proposal.affectedStudents === 1 ? "" : "s"} · effective {formatDate(proposal.effectiveDate)}</small></div><form action={approveBatchRolloverAction}><input type="hidden" name="proposalId" value={proposal.proposalId} /><button className="btn" type="submit">Approve rollover</button></form></div>)}</section>}
      {unread > 0 && (
        <form action={markAllAdminNotificationsReadAction}><button className="btn btn-secondary" type="submit">Mark all as read</button></form>
      )}
      {items.length === 0 ? (
        <div className="card"><p className="muted">You have no notifications.</p></div>
      ) : (
        items.map((n) => (
          <div key={n.notificationId} className={`notif${n.isRead ? "" : " unread"}`}>
            <strong>{n.title}</strong> <small>{formatDateTime(n.createdAt)}</small>
            <div>{n.message}</div>
            <div className="row">
              {n.submissionId && <Link href={`/admin/submissions/${n.submissionId}`}>Open submission</Link>}
              {!n.isRead && (
                <form action={markAdminNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={n.notificationId} />
                  <button className="btn btn-secondary" type="submit">Mark as read</button>
                </form>
              )}
            </div>
          </div>
        ))
      )}
    </AdminPage>
  );
}
