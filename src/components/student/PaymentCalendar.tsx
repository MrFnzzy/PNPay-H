"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { INSTALLMENT_LABEL, isSubmittable, type InstallmentStatus } from "@/lib/payments/status";

export interface CalendarItem { obligationId: string; periodLabel: string; amountCents: number; dueDate: string; status: InstallmentStatus; }
type MonthStatus = "paid" | "due" | "not-due";

function monthTitle(month: string) { const [year, number] = month.split("-").map(Number); return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" }); }
function statusFor(items: CalendarItem[], today: string): MonthStatus { if (items.length > 0 && items.every((item) => item.status === "paid")) return "paid"; if (items.some((item) => item.status !== "paid" && item.dueDate <= today)) return "due"; return "not-due"; }

export default function PaymentCalendar({ items, today }: { items: CalendarItem[]; today: string }) {
  const months = useMemo(() => Array.from(new Set(items.map((item) => item.dueDate.slice(0, 7)))).sort(), [items]);
  const [selectedMonth, setSelectedMonth] = useState(months.find((month) => month >= today.slice(0, 7)) ?? months[0]);
  const visibleItems = items.filter((item) => item.dueDate.startsWith(selectedMonth ?? ""));
  const selected = visibleItems.find((item) => item.status !== "paid") ?? visibleItems[0];
  return <div className="student-month-calendar">
    <div className="calendar-toolbar"><div><span className="eyebrow">Payment calendar</span><h2 className="calendar-title">Your months at a glance</h2></div><div className="calendar-legend"><span><i className="legend-dot paid" />Paid</span><span><i className="legend-dot due" />Due</span><span><i className="legend-dot not-due" />Not due</span></div></div>
    <div className="month-status-grid" role="list" aria-label="Monthly payment status">
      {months.map((month) => { const monthItems = items.filter((item) => item.dueDate.startsWith(month)); const status = statusFor(monthItems, today); const total = monthItems.reduce((sum, item) => sum + item.amountCents, 0); return <button key={month} type="button" className={`status-month ${status}${selectedMonth === month ? " selected" : ""}`} onClick={() => setSelectedMonth(month)} aria-pressed={selectedMonth === month}><span className="status-month-top"><strong>{monthTitle(month)}</strong><span className="status-check">{status === "paid" ? "✓" : status === "due" ? "!" : "·"}</span></span><small>{monthItems.length} payment{monthItems.length === 1 ? "" : "s"}</small><b>{formatPeso(total)}</b><span className="status-label">{status === "paid" ? "Paid" : status === "due" ? "Due" : "Not due"}</span></button>; })}
    </div>
    {selected && <div className="card cal-detail" aria-live="polite"><div className="row"><div><span className="eyebrow">Selected month</span><strong>{monthTitle(selectedMonth)}</strong></div><span className="spacer" /><span className={`pill s-${selected.status}`}>{INSTALLMENT_LABEL[selected.status]}</span></div><div className="month-detail-list">{visibleItems.map((item) => <div key={item.obligationId} className="month-detail-row"><div><strong>{item.periodLabel}</strong><small>Due {formatDate(item.dueDate)}</small></div><strong>{formatPeso(item.amountCents)}</strong>{isSubmittable(item.status) && <Link href={`/student/submit?obligation=${item.obligationId}`}>Submit receipt</Link>}</div>)}</div></div>}
  </div>;
}
