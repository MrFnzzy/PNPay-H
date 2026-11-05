import Link from "next/link";

export default function Home() {
  return (
    <main className="auth-wrap">
      <div className="card">
        <span className="brand">PNPay-H</span>
        <h1>Student Payment Verification</h1>
        <p className="muted">Pay through GCash or another payment app, then submit your receipt here for verification.</p>
        <p><Link className="btn" href="/login">Student login</Link></p>
        <p><Link href="/register">Create a student account</Link></p>
        <p className="muted"><Link href="/admin/login">Administrator login</Link></p>
      </div>
    </main>
  );
}
