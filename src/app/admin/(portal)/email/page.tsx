import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { Alert, SubmitButton } from "@/components/ui";
import { processEmailQueueNowAction, retryAllFailedEmailsAction, retryEmailAction } from "@/app/actions/admin";
import { getEmailOverview, STALE_QUEUE_MINUTES } from "@/lib/email/queue";
import { formatDateTime } from "@/lib/payments/dates";

export const metadata = { title: "Email delivery" };
export const dynamic = "force-dynamic";

const STATE_LABEL = { failed: "Failed", retrying: "Retrying", waiting: "Waiting" } as const;
const TYPE_LABEL: Record<string, string> = {
  submission_received: "Receipt submitted",
  submission_verified: "Receipt verified",
  correction_requested: "Correction requested",
  submission_rejected: "Receipt rejected",
  payment_reminder: "Payment reminder",
  installment_overdue: "Overdue notice",
};
const JOB_LABEL: Record<string, string> = { reminders: "Payment reminders", email: "Email delivery", cleanup: "Upload cleanup" };

const ERROR_MESSAGE: Record<string, string> = {
  invalid: "That email could not be identified.",
  not_failed: "Only an email that failed can be retried.",
  forbidden: "You are not allowed to do that.",
  failed: "Something went wrong. Please try again.",
};

type SP = { retried?: string; error?: string; processed?: string; sent?: string; failed?: string };

export default async function EmailDelivery({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, unread } = await loadAdmin();
  const sp = await searchParams;
  const o = await getEmailOverview();
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <h1>Email delivery</h1>
      <p className="muted">
        Payment emails are sent after each action and retried automatically. A failed email never affects the payment itself. Details of messages are not stored here.
      </p>
      {sp.retried && <Alert kind="success">{Number(sp.retried) === 1 ? "The email was queued for another attempt." : `${Number(sp.retried)} emails were queued for another attempt.`}</Alert>}
      {sp.processed !== undefined && <Alert kind="info">Checked the queue: {Number(sp.processed)} due, {Number(sp.sent)} sent, {Number(sp.failed)} failed or will be retried.</Alert>}
      {sp.error && <Alert kind="error">{ERROR_MESSAGE[sp.error] ?? ERROR_MESSAGE.failed}</Alert>}

      <div className="stats">
        <div className="stat"><div className="label">Waiting to send</div><div className="value">{o.counts.queued}</div></div>
        <div className="stat"><div className="label">Failed</div><div className="value">{o.counts.failed}</div></div>
        <div className="stat"><div className="label">Sent</div><div className="value">{o.counts.sent}</div></div>
      </div>

      <div className="row">
        <form action={processEmailQueueNowAction}><SubmitButton className="btn btn-secondary" pending="Processing…">Send waiting emails now</SubmitButton></form>
        {o.counts.failed > 0 && <form action={retryAllFailedEmailsAction}><SubmitButton pending="Queueing retries…">Retry all failed ({o.counts.failed})</SubmitButton></form>}
      </div>

      <h2 className="section">Emails needing attention</h2>
      {o.problems.length === 0 ? (
        <div className="card"><p className="muted">No failed, retrying or stuck emails.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>When</th><th>Email</th><th>Recipient</th><th>State</th><th>Attempts</th><th>Last error</th><th></th></tr></thead>
            <tbody>
              {o.problems.map((p) => (
                <tr key={p.notificationId}>
                  <td>{formatDateTime(p.createdAt)}</td>
                  <td>{TYPE_LABEL[p.type] ?? p.type}</td>
                  <td>{p.recipientName}<br /><small>{p.recipientEmailMasked}</small></td>
                  <td>
                    <span className={`pill ${p.state === "failed" ? "s-rejected" : "s-pending_review"}`}>{STATE_LABEL[p.state]}</span>
                    {p.state === "retrying" && p.nextAttemptAt && <><br /><small>next try {formatDateTime(p.nextAttemptAt)}</small></>}
                    {p.state === "waiting" && <><br /><small>queued over {STALE_QUEUE_MINUTES} min</small></>}
                  </td>
                  <td>{p.attempts}</td>
                  <td><small>{p.lastError ?? "—"}</small></td>
                  <td>
                    {p.state === "failed" && (
                      <form action={retryEmailAction}>
                        <input type="hidden" name="notificationId" value={p.notificationId} />
                        <SubmitButton className="btn btn-secondary" pending="Queueing…">Retry</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Scheduled jobs</h2>
      {o.lastRuns.length === 0 ? (
        <Alert kind="info">No scheduled job has run yet. Check that CRON_SECRET is set on Vercel and that the cron job is enabled (see docs/DEPLOYMENT.md).</Alert>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Job</th><th>Last run</th><th>Result</th><th>Counts</th></tr></thead>
            <tbody>
              {o.lastRuns.map((r) => (
                <tr key={r.job}>
                  <td>{JOB_LABEL[r.job] ?? r.job}</td>
                  <td>{formatDateTime(r.startedAt)}</td>
                  <td>{r.ok === null ? "Running / interrupted" : r.ok ? "OK" : `Failed (${r.error ?? "error"})`}</td>
                  <td><small>{Object.entries((r.summary ?? {}) as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  );
}
