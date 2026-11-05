import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 18 18" fill="none"><path d="m4 9.2 3.1 3.1L14 5.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function AuthCard({ title, children, subtitle }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <Link href="/" className="auth-brand" aria-label="PNPay-H home"><BrandMark /></Link>
        <div className="auth-layout">
          <aside className="auth-story">
            <p className="auth-story-kicker"><span aria-hidden="true" />THE STUDENT PAYMENT PORTAL</p>
            <h2>Every payment.<br /><span>Nothing left to guess.</span></h2>
            <p className="auth-story-copy">A straightforward way to keep your payment schedule, receipts, and review status together.</p>
            <div className="auth-points">
              <div className="auth-point"><span>01</span><p><strong>Know what’s due</strong><small>See your schedule in one place.</small></p></div>
              <div className="auth-point"><span>02</span><p><strong>Keep receipts together</strong><small>Submit and revisit your records.</small></p></div>
              <div className="auth-point"><span>03</span><p><strong>Follow every update</strong><small>Check review status when you need it.</small></p></div>
            </div>
            <div className="auth-story-foot"><span className="auth-foot-check"><CheckIcon /></span><span>Clear records. Trusted review.<small>PNPay-H records payments; it does not process them.</small></span></div>
          </aside>
          <section className="auth-card">
            <div className="auth-card-kicker"><span className="auth-card-check"><CheckIcon /></span>SECURE ACCOUNT ACCESS</div>
            <h1>{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            {children}
            <Link href="/" className="auth-back">Back to PNPay-H home</Link>
          </section>
        </div>
        <footer className="auth-footer"><span>PNPay-H</span><span>Student payment records, made clear.</span></footer>
      </div>
    </main>
  );
}
