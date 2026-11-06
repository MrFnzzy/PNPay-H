import Link from "next/link";
import BrandMark from "@/components/BrandMark";

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M3.5 10h12M10.5 4.5 16 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 18 18" fill="none"><path d="m4 9.2 3.1 3.1L14 5.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function Home() {
  return (
    <main className="site-home">
      <div className="home-shell">
        <header className="home-header">
          <Link href="/" className="home-brand" aria-label="PNPay-H home"><BrandMark /></Link>
          <nav className="home-nav" aria-label="Primary navigation">
            <span className="home-nav-note"><span aria-hidden="true" />A clearer way to stay on track</span>
            <Link href="/admin/login" className="home-admin-link">Administrator access <ArrowIcon /></Link>
          </nav>
        </header>
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-copy">
            <p className="home-eyebrow"><span aria-hidden="true" />STUDENT PAYMENT RECORDS</p>
            <h1 id="home-title">Your payments,<br /><span>in clear view.</span></h1>
            <p className="home-lead">Know what’s due, send in your receipts, and follow each review—all from one calm, reliable place.</p>
            <div className="home-actions">
              <Link href="/register" className="home-primary">Create your student account <ArrowIcon /></Link>
              <Link href="/login" className="home-login">Already registered? <strong>Sign in</strong></Link>
            </div>
            <div className="home-assurance"><span className="home-assurance-icon"><CheckIcon /></span><span>Clear records, built for students</span><span className="home-assurance-divider" /><span>Reviewed by your school</span></div>
          </div>
          <div className="home-art" aria-label="Sample preview of a student payment record">
            <div className="home-art-orbit home-art-orbit-one" aria-hidden="true" /><div className="home-art-orbit home-art-orbit-two" aria-hidden="true" />
            <div className="home-float-tag home-float-tag-top"><span className="home-float-check"><CheckIcon /></span><span><strong>Receipt verified</strong><small>Your record is up to date</small></span></div>
            <div className="home-receipt">
              <div className="receipt-heading"><span className="receipt-label">PNPAY-H&nbsp; / &nbsp;STUDENT LEDGER</span><span className="receipt-chip">SAMPLE VIEW</span></div>
              <div className="receipt-rule" />
              <div className="receipt-title-row"><div><span className="receipt-overline">PAYMENT SUMMARY</span><h2>Your record</h2></div><span className="receipt-mark"><CheckIcon /></span></div>
              <div className="receipt-total"><span>Remaining balance</span><strong>₱ 2,450.00</strong></div>
              <div className="receipt-progress-head"><span>Payment progress</span><strong>68%</strong></div>
              <div className="receipt-progress"><span /></div>
              <div className="receipt-activity">
                <div className="receipt-activity-row"><span className="receipt-activity-icon receipt-icon-blue"><CheckIcon /></span><span><strong>March installment</strong><small>Receipt verified</small></span><b>₱ 1,200</b></div>
                <div className="receipt-activity-row"><span className="receipt-activity-icon receipt-icon-orange"><span aria-hidden="true">↗</span></span><span><strong>April installment</strong><small>Next payment due</small></span><b>₱ 950</b></div>
              </div>
              <div className="receipt-foot"><span className="receipt-foot-dot" />A sample of what staying on track looks like</div>
            </div>
            <div className="home-float-tag home-float-tag-bottom"><span className="home-calendar-icon" aria-hidden="true">18</span><span><strong>Next due date</strong><small>Easy to see at a glance</small></span><ArrowIcon /></div>
            <div className="home-art-index" aria-hidden="true">01 <span /> RECORDS THAT MAKE SENSE</div>
          </div>
        </section>
        <section className="home-benefits" aria-label="How PNPay-H helps">
          <div className="benefit-item"><span className="benefit-number">01</span><span><strong>See what’s due</strong><small>Payment schedules, made simple.</small></span></div>
          <div className="benefit-item"><span className="benefit-number">02</span><span><strong>Send your receipt</strong><small>Keep each payment on record.</small></span></div>
          <div className="benefit-item"><span className="benefit-number">03</span><span><strong>Follow the review</strong><small>Know when your status changes.</small></span></div>
          <div className="benefit-disclaimer">PNPay-H records payments; it does not process them.</div>
        </section>
      </div>
    </main>
  );
}
