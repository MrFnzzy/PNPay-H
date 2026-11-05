import Link from "next/link";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { markAdminNotificationReadAction, markAllAdminNotificationsReadAction } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications() {
  const { user, unread } = await loadAdmin();
  const items = await getNotifications(user.userId); // scoped to the session administrator
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Notifications</h1>
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
