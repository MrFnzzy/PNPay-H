import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";

const STUDENT_NAV = [
  { href: "/student/dashboard", label: "Dashboard" },
  { href: "/student/tracker", label: "Payment tracker" },
  { href: "/student/calendar", label: "Calendar" },
  { href: "/student/submit", label: "Submit receipt" },
  { href: "/student/history", label: "History" },
  { href: "/student/notifications", label: "Notifications" },
];

const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/records", label: "Student records" },
  { href: "/admin/records?submission=pending_review&sort=submission_date", label: "Review queue" },
  { href: "/admin/schedules", label: "Payment schedules" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/email", label: "Email delivery" },
];

export default function PortalShell({ portal, name, unread = 0, children }: { portal: "student" | "admin"; name: string; unread?: number; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <strong>PNPay-H</strong>
        <span className="muted">{portal === "admin" ? "Administrator" : "Student"} portal</span>
        <span className="spacer" />
        <span>{name}</span>
        <form action={logoutAction}>
          <input type="hidden" name="portal" value={portal} />
          <button className="btn btn-secondary" type="submit">Log out</button>
        </form>
      </header>
      <nav className="subnav" aria-label={portal === "admin" ? "Administrator navigation" : "Student navigation"}>
        {(portal === "admin" ? ADMIN_NAV : STUDENT_NAV).map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
            {n.href.endsWith("notifications") && unread > 0 && <span className="badge-count" aria-label={`${unread} unread`}>{unread}</span>}
          </Link>
        ))}
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
