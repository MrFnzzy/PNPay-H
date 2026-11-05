"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/payments/dates";
import { formatPeso } from "@/lib/payments/money";
import { INSTALLMENT_LABEL, isSubmittable, type InstallmentStatus } from "@/lib/payments/status";

export interface CalendarItem {
  obligationId: string;
  periodLabel: string;
  amountCents: number;
  dueDate: string;
  status: InstallmentStatus;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Read-only view: selecting an item only shows its details; nothing here changes any payment data. */
export default function PaymentCalendar({ items, today }: { items: CalendarItem[]; today: string }) {
  const first = items[0]?.dueDate.slice(0, 7) ?? today.slice(0, 7);
  const initial = items.find((i) => i.dueDate.slice(0, 7) >= today.slice(0, 7))?.dueDate.slice(0, 7) ?? first;
  const [month, setMonth] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);

  const [y, m] = month.split("-").map(Number);
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const i of items) if (i.dueDate.startsWith(month)) map.set(Number(i.dueDate.slice(8, 10)), [...(map.get(Number(i.dueDate.slice(8, 10))) ?? []), i]);
    return map;
  }, [items, month]);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const sel = items.find((i) => i.obligationId === selected) ?? null;
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" });

  return (
    <div>
      <div className="cal-head">
        <button type="button" className="btn btn-secondary" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong aria-live="polite">{title}</strong>
        <button type="button" className="btn btn-secondary" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {Array.from({ length: startDow }).map((_, i) => <div key={`e${i}`} className="cal-cell empty" />)}
        {Array.from({ length: days }).map((_, idx) => {
          const day = idx + 1;
          return (
            <div key={day} className="cal-cell">
              {day}
              {(byDay.get(day) ?? []).map((i) => (
                <button key={i.obligationId} type="button" className={`s-${i.status}`} onClick={() => setSelected(i.obligationId)} aria-pressed={selected === i.obligationId}>
                  {i.periodLabel}: {INSTALLMENT_LABEL[i.status]}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <p className="muted">Legend: Paid · Pending Verification · Not Yet Due (upcoming) · Overdue / Requires Resubmission.</p>
      <div className="card cal-detail" aria-live="polite">
        {sel ? (
          <dl>
            <dt>Installment</dt><dd>{sel.periodLabel}</dd>
            <dt>Amount</dt><dd>{formatPeso(sel.amountCents)}</dd>
            <dt>Due date</dt><dd>{formatDate(sel.dueDate)}</dd>
            <dt>Status</dt><dd><span className={`pill s-${sel.status}`}>{INSTALLMENT_LABEL[sel.status]}</span></dd>
            {isSubmittable(sel.status) && <dd><Link href={`/student/submit?obligation=${sel.obligationId}`}>Submit a receipt for this installment</Link></dd>}
          </dl>
        ) : (
          <p className="muted">Select an installment on the calendar to see its details.</p>
        )}
      </div>
    </div>
  );
}
