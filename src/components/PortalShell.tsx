import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";

const STUDENT_NAV = [
  { href: "/student/dashboard", label: "Overview" },
  { href: "/student/tracker", label: "Payment tracker" },
  { href: "/student/calendar", label: "Calendar" },
  { href: "/student/submit", label: "Submit receipt" },
  { href: "/student/history", label: "History" },
  { href: "/student/notifications", label: "Notifications" },
];
const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Overview" },
  { href: "/admin/monthly-review", label: "Monthly Payment Review" },
  { href: "/admin/records", label: "Student records" },
  { href: "/admin/records?submission=pending_review&sort=submission_date", label: "Review queue" },
  { href: "/admin/schedules", label: "Payment schedules" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/email", label: "Email delivery" },
];

export default function PortalShell({ portal, name, unread = 0, children }: { portal: "student" | "admin"; name: string; unread?: number; children: ReactNode }) {
  const nav = portal === "admin" ? ADMIN_NAV : STUDENT_NAV;
  return <div className="app-frame">
    <aside className="sidebar">
      <Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark"><span className="brand-dot" /><span>PNPay<span>-H</span></span></Link>
      <div className="sidebar-kicker">{portal === "admin" ? "Admin workspace" : "Student space"}</div>
      <nav className="side-nav" aria-label={portal === "admin" ? "Administrator navigation" : "Student navigation"}>
        {nav.map((n, index) => <Link key={n.href} href={n.href} className={index === 0 ? "nav-link active" : "nav-link"}><span className="nav-icon" aria-hidden="true">{["⌂", "◷", "▦", "✓", "▤", "◌", "✉"][index] ?? "•"}</span><span>{n.label}</span>{n.href.endsWith("notifications") && unread > 0 && <span className="badge-count" aria-label={`${unread} unread`}>{unread}</span>}</Link>)}
      </nav>
      <div className="sidebar-bottom"><div className="mini-card"><strong>{portal === "admin" ? "Keep payments moving." : "Stay on track."}</strong><span>{portal === "admin" ? "Review receipts before the next deadline." : "Your next payment is only a glance away."}</span></div><form action={logoutAction}><input type="hidden" name="portal" value={portal} /><button className="logout-link" type="submit"><span>↪</span> Log out</button></form></div>
    </aside>
    <div className="page-column">
      <header className="mobile-topbar"><Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark"><span className="brand-dot" /><span>PNPay<span>-H</span></span></Link><div className="mobile-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></div></header>
      <main className="container"><div className="page-heading"><div><span className="eyebrow">{portal === "admin" ? "Administrator portal" : "Student portal"}</span><span className="heading-rule" /></div><div className="desktop-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></div></div>{children}</main>
    </div>
  </div>;
}
