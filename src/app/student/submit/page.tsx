import ReceiptForm from "@/components/student/ReceiptForm";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { getEnv } from "@/lib/env";
import { manilaToday } from "@/lib/payments/dates";
import { getInstallments } from "@/lib/payments/queries";
import { isSubmittable } from "@/lib/payments/status";

export const metadata = { title: "Submit a receipt" };
export const dynamic = "force-dynamic";

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ obligation?: string }> }) {
  const { user, unread } = await loadStudent();
  const { obligation } = await searchParams;
  const today = manilaToday();
  // Only this student's installments that can still receive a receipt; a preselected id outside this list is ignored.
  const eligible = (await getInstallments(user.userId, today)).filter((i) => isSubmittable(i.status));
  return (
    <StudentPage name={user.fullName} unread={unread}>
      <h1>Submit a payment receipt</h1>
      <p className="muted">Pay first through GCash or another supported app, then upload the receipt screenshot here. Your payment counts only after it is verified.</p>
      <div className="card">
        <ReceiptForm
          studentName={user.fullName}
          studentId={user.studentId ?? ""}
          installments={eligible.map((i) => ({ obligationId: i.obligationId, label: i.periodLabel, amountCents: i.amountCents, dueDate: i.dueDate }))}
          selectedId={eligible.find((i) => i.obligationId === obligation)?.obligationId}
          today={today}
          maxMb={Math.floor(getEnv().RECEIPT_MAX_BYTES / 1024 / 1024)}
        />
      </div>
    </StudentPage>
  );
}
