import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPage, { loadAdmin } from "@/components/admin/AdminPage";
import { DeleteBatchPlanForm, EditBatchPlanForm } from "@/components/admin/ScheduleForms";
import { getBatchPlan } from "@/lib/admin/schedules";
import { batchLabel } from "@/lib/batches";
import { formatDate } from "@/lib/payments/dates";
import { STANDARD_INSTALLMENT_AMOUNT } from "@/lib/payments/money";

export const metadata = { title: "Edit batch plan" };
export const dynamic = "force-dynamic";

export default async function EditBatchPlan({ params }: { params: Promise<{ batch: string }> }) {
  const { user, unread } = await loadAdmin();
  const { batch: raw } = await params;
  const batch = decodeURIComponent(raw);
  const plan = await getBatchPlan(batch);
  if (!plan) notFound();
  return (
    <AdminPage name={user.fullName} unread={unread}>
      <p><Link href="/admin/schedules">← Payment schedules</Link></p>
      <h1>{batchLabel(plan.batch)} plan</h1>
      <p className="muted">
        Currently {formatDate(plan.firstDueDate)} – {formatDate(plan.lastDueDate)} · {plan.months} months · ₱{plan.amount} per month · {plan.students} active student{plan.students === 1 ? "" : "s"} in this batch
      </p>
      <EditBatchPlanForm
        batch={plan.batch}
        firstDueDate={plan.firstDueDate}
        lastDueDate={plan.lastDueDate}
        amount={plan.amount}
        amountNote={plan.amountNote ?? ""}
        standardAmount={STANDARD_INSTALLMENT_AMOUNT}
        students={plan.students}
      />
      <DeleteBatchPlanForm batch={plan.batch} students={plan.students} />
    </AdminPage>
  );
}
