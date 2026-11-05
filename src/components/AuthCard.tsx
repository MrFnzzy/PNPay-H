import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthCard({ title, children, subtitle }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="card">
        <Link href="/" className="brand">PNPay-H</Link>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}
