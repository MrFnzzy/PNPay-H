import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { DeleteObligationForm, EditObligationForm } from "@/components/admin/ScheduleForms";
import { InstallmentPill } from "@/components/student/StatusPill";
import { Alert } from "@/components/ui";
import { getObligationForEdit } from "@/lib/admin/schedules";
import { formatDate, formatDateTime } from "@/lib/payments/dates";
import { formatPeso, STANDARD_INSTALLMENT_AMOUNT } from "@/lib/payments/money";

export const metadata = { title: "Edit installment" };
export const dynamic = "force-dynamic";

export default async function EditObligation({ params, searchParams }: { params: Promise<{ obligationId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { user, unread } = await loadAdmin();
  const { obligationId } = await params;
  const o = await getObligationForEdit(obligationId);
  if (!o) notFound();
  const sp = await searchParams;
  const editable = o.rules.canEditAmount || o.rules.canEditDueDate || o.rules.canEditPeriod;
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <p><Link href="/admin/schedules">← Payment schedules</Link></p>
      <h1>{o.periodLabel} — {o.studentName}</h1>
      <p className="muted">
        Student ID {o.studentCode} · {o.academicYear} · {formatPeso(Math.round(Number(o.amount) * 100))} due {formatDate(o.dueDate)} · <InstallmentPill status={o.rules.status} />
      </p>
      {sp.saved && <Alert kind="success">The change was saved and recorded.</Alert>}
      {o.rules.reason && <Alert kind="info">{o.rules.reason}</Alert>}
      {editable && (
        <EditObligationForm
          obligationId={o.obligationId}
          academicYear={o.academicYear}
          periodLabel={o.periodLabel}
          dueDate={o.dueDate}
          amount={o.amount}
          standardAmount={STANDARD_INSTALLMENT_AMOUNT}
          canEditAmount={o.rules.canEditAmount}
          canEditDueDate={o.rules.canEditDueDate}
          canEditPeriod={o.rules.canEditPeriod}
        />
      )}
      <DeleteObligationForm obligationId={o.obligationId} periodLabel={o.periodLabel} paid={o.rules.status === "paid"} receipts={o.rules.submissionCount} />
      <p><Link href={`/admin/students/${o.studentId}`}>Open this student’s record</Link></p>
      <h2 className="section">Change history</h2>
      {o.history.length === 0 ? (
        <div className="card"><p className="muted">No administrative changes have been recorded for this installment.</p></div>
      ) : (
        o.history.map((h) => (
          <div key={h.eventId} className="history-item">
            <div>{h.action === "obligation_updated" ? "Updated" : h.action} by {h.adminName} on {formatDateTime(h.createdAt)}</div>
            <small>{JSON.stringify((h.details as { changes?: unknown }).changes ?? {})}</small>
          </div>
        ))
      )}
    </AdminPage>
  );
}
