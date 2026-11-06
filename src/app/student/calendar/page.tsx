import PaymentCalendar from "@/components/student/PaymentCalendar";
import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import { manilaToday } from "@/lib/payments/dates";
import { getInstallments } from "@/lib/payments/queries";

export const metadata = { title: "Monthly payment calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { user, unread } = await loadStudent();
  const today = manilaToday();
  const items = (await getInstallments(user.userId, today)).map((i) => ({ obligationId: i.obligationId, periodLabel: i.periodLabel, amountCents: i.amountCents, dueDate: i.dueDate, status: i.status }));
  return <StudentPage name={user.fullName} unread={unread}><span className="eyebrow">Student space / planner</span><h1>Monthly payment calendar</h1><p className="muted calendar-page-lead">No day-by-day clutter — just the months you need to act on, color-coded at a glance.</p>{items.length === 0 ? <div className="card"><p>No installments have been scheduled for you yet.</p></div> : <PaymentCalendar items={items} today={today} />}</StudentPage>;
}
