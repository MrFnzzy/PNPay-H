import Link from "next/link";

export default function Home() {
  return (
    <main className="ledger-home">
      <section className="ledger-page" aria-labelledby="ledger-title">
        <header className="ledger-header">
          <Link className="ledger-wordmark" href="/" aria-label="PNPay-H home">
            <span className="ledger-mark" aria-hidden="true">P</span>
            <span>PNPay<span>-H</span></span>
          </Link>
          <Link className="ledger-admin" href="/admin/login">Administrator sign in</Link>
        </header>

        <div className="ledger-main">
          <div className="ledger-copy">
            <p className="ledger-kicker">Student payment records</p>
            <h1 id="ledger-title">Every receipt.<br />One clear record.</h1>
            <p className="ledger-lead">Track due dates, send receipts, and see what has been verified.</p>
            <div className="ledger-actions">
              <Link className="btn ledger-primary" href="/register">Create an account</Link>
              <Link className="ledger-login" href="/login">Sign in</Link>
            </div>
          </div>

          <div className="ledger-note" aria-label="How PNPay-H works">
            <div className="ledger-note-top"><span>Payment record</span><span>PNPay-H</span></div>
            <div className="ledger-note-rule" />
            <div className="ledger-note-row"><span>01</span><strong>See what is due</strong></div>
            <div className="ledger-note-row"><span>02</span><strong>Send your receipt</strong></div>
            <div className="ledger-note-row"><span>03</span><strong>Follow the review</strong></div>
            <div className="ledger-note-footer">A simpler way to stay on track.</div>
          </div>
        </div>

        <footer className="ledger-footer">
          <span>For students and administrators.</span>
          <span>PNPay-H records payments; it does not process them.</span>
        </footer>
      </section>
    </main>
  );
}
