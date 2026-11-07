import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { approveBatchRolloverAction, openBatchAction, markAdminNotificationReadAction, markAllAdminNotificationsReadAction } from "@/app/actions/admin";
import { listPendingBatchRolloverProposals } from "@/lib/admin/batches";
import { getActiveBatches, getPendingNewBatch } from "@/lib/batch-window";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";
import { SubmitButton } from "@/components/ui";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ rolloverApproved?: string; rolloverError?: string; batchOpened?: string; batchError?: string }> }) {
  const { user, unread } = await loadAdmin();
  const [items, proposals, newBatch, activeBatches] = await Promise.all([
    getNotifications(user.userId), // scoped to the session administrator
    listPendingBatchRolloverProposals(),
    getPendingNewBatch(),
    getActiveBatches(),
  ]);
  const sp = await searchParams;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Notifications</h1>
      {sp.rolloverApproved && <div className="alert success">Batch rollover approved. Affected students are now marked Alumni; payment history was preserved.</div>}
      {sp.rolloverError && <div className="alert error">That batch rollover could not be approved. It may already have been handled.</div>}
      {sp.batchOpened && <div className="alert success">The new batch is open. It now appears in registration and in every batch list.</div>}
      {sp.batchError && <div className="alert error">That batch could not be opened. It may already be open.</div>}
      {newBatch && <section className="card rollover-panel"><span className="eyebrow">Approval required</span><h2 className="section">New batch {newBatch.batch}</h2><p className="muted">Batch {newBatch.batch} started in {formatDate(newBatch.startDate)}. Current batches: {activeBatches.join(", ")}. Nothing is added until you approve, so you can wait if the intake is delayed.</p><div className="rollover-proposal"><div><strong>Open Batch {newBatch.batch}</strong><small>Students can register into it and you can create its payment plan.</small></div><form action={openBatchAction}><input type="hidden" name="batch" value={newBatch.batch} /><SubmitButton pending="Opening…">Open Batch {newBatch.batch}</SubmitButton></form></div></section>}
      {proposals.length > 0 && <section className="card rollover-panel"><span className="eyebrow">Approval required</span><h2 className="section">Batch rollover proposals</h2><p className="muted">The system detected cohorts that completed their 30-month window. No student was changed yet.</p>{proposals.map((proposal) => <div className="rollover-proposal" key={proposal.proposalId}><div><strong>Batch {proposal.fromBatch} → Alumni</strong><small>{proposal.affectedStudents} student{proposal.affectedStudents === 1 ? "" : "s"} · effective {formatDate(proposal.effectiveDate)}</small></div><form action={approveBatchRolloverAction}><input type="hidden" name="proposalId" value={proposal.proposalId} /><SubmitButton pending="Approving…">Approve rollover</SubmitButton></form></div>)}</section>}
      {unread > 0 && (
        <form action={markAllAdminNotificationsReadAction}><SubmitButton className="btn btn-secondary" pending="Marking all read…">Mark all as read</SubmitButton></form>
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
                  <SubmitButton className="btn btn-secondary" pending="Marking read…">Mark as read</SubmitButton>
                </form>
              )}
            </div>
          </div>
        ))
      )}
    </AdminPage>
  );
}
