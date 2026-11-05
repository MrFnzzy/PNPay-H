"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

const STUDENT_NAV = [
  { href: "/student/dashboard", label: "Overview", icon: "⌂" },
  { href: "/student/tracker", label: "Payment tracker", icon: "◷" },
  { href: "/student/calendar", label: "Calendar", icon: "▦" },
  { href: "/student/submit", label: "Submit receipt", icon: "✓" },
  { href: "/student/history", label: "History", icon: "▤" },
  { href: "/student/notifications", label: "Notifications", icon: "◌" },
];
const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Overview", icon: "⌂" },
  { href: "/admin/monthly-review", label: "Monthly Payment Review", icon: "◷" },
  { href: "/admin/students", label: "Students", icon: "♙" },
  { href: "/admin/records", label: "Student records", icon: "▦" },
  { href: "/admin/records?submission=pending_review&sort=submission_date", label: "Review queue", icon: "✓" },
  { href: "/admin/schedules", label: "Payment schedules", icon: "▤" },
  { href: "/admin/notifications", label: "Notifications", icon: "◌" },
  { href: "/admin/email", label: "Email delivery", icon: "✉" },
];

export default function PortalShell({ portal, name, unread = 0, children }: { portal: "student" | "admin"; name: string; unread?: number; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nav = portal === "admin" ? ADMIN_NAV : STUDENT_NAV;
  const isActive = (href: string) => {
    const base = href.split("?")[0];
    if (pathname === "/admin/records" && base === "/admin/records") return href.includes("submission=") ? searchParams.get("submission") === "pending_review" : searchParams.get("submission") !== "pending_review";
    return pathname === base || (base !== "/admin/dashboard" && base !== "/student/dashboard" && pathname.startsWith(`${base}/`));
  };
  return <div className="app-frame">
    <aside className="sidebar">
      <Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark"><span className="brand-dot" /><span>PNPay<span>-H</span></span></Link>
      <div className="sidebar-kicker">{portal === "admin" ? "Admin workspace" : "Student space"}</div>
      <nav className="side-nav" aria-label={portal === "admin" ? "Administrator navigation" : "Student navigation"}>
        {nav.map((n) => <Link key={n.href} href={n.href} className={`nav-link${isActive(n.href) ? " active" : ""}`} aria-current={isActive(n.href) ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{n.icon}</span><span>{n.label}</span>{n.href.endsWith("notifications") && unread > 0 && <span className="badge-count" aria-label={`${unread} unread`}>{unread}</span>}</Link>)}
      </nav>
      <div className="sidebar-bottom"><div className="mini-card"><span className="mini-card-spark">✦</span><strong>{portal === "admin" ? "Keep payments moving." : "Stay on track."}</strong><span>{portal === "admin" ? "Review receipts before the next deadline." : "Your next payment is only a glance away."}</span></div><form action={logoutAction}><input type="hidden" name="portal" value={portal} /><button className="logout-link" type="submit"><span>↪</span> Log out</button></form></div>
    </aside>
    <div className="page-column">
      <header className="mobile-topbar"><Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark"><span className="brand-dot" /><span>PNPay<span>-H</span></span></Link><div className="mobile-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="mobile-user-name">{name}</span></div></header>
      <main className="container"><div className="page-heading"><div><span className="eyebrow">{portal === "admin" ? "Administrator portal" : "Student portal"}</span><span className="heading-rule" /></div><div className="desktop-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></div></div>{children}</main>
    </div>
  </div>;
}
