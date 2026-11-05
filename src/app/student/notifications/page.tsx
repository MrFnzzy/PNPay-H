import Link from "next/link";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/student";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { formatDateTime } from "@/lib/payments/dates";
import { getNotifications } from "@/lib/payments/queries";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const { user, unread } = await loadStudent();
  const list = await getNotifications(user.userId);
  return (
    <StudentPage name={user.fullName} unread={unread}>
      <div className="row">
        <h1>Payment notifications</h1>
        <span className="spacer" />
        {unread > 0 && (
          <form action={markAllNotificationsReadAction}>
            <button className="btn btn-secondary" type="submit">Mark all as read</button>
          </form>
        )}
      </div>
      {list.length === 0 ? (
        <div className="card"><p>No payment notifications yet.</p></div>
      ) : (
        list.map((n) => (
          <div key={n.notificationId} className={`notif${n.isRead ? "" : " unread"}`}>
            <strong>{n.title}</strong> {!n.isRead && <span className="pill s-pending_review">Unread</span>}
            <div>{n.message}</div>
            <small>{formatDateTime(n.createdAt)}</small>
            <div className="row">
              <Link href={n.submissionId ? `/student/history#s-${n.submissionId}` : n.obligationId ? `/student/tracker#o-${n.obligationId}` : "/student/tracker"}>View payment details</Link>
              {!n.isRead && (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={n.notificationId} />
                  <button className="btn btn-secondary" type="submit">Mark as read</button>
                </form>
              )}
            </div>
          </div>
        ))
      )}
    </StudentPage>
  );
}
