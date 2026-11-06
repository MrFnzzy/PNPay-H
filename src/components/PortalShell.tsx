"use client";

import type { ReactNode } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import BrandMark from "@/components/BrandMark";
import { SubmitButton } from "@/components/ui";

type IconName = "dashboard" | "tracker" | "calendar" | "upload" | "history" | "bell" | "users" | "schedule" | "mail" | "logout";
type NavItem = { href: string; label: string; icon: IconName };

function LinkPendingIndicator() {
  const { pending } = useLinkStatus();
  return <span className={`nav-link-pending${pending ? " is-pending" : ""}`} aria-hidden="true" />;
}

const STUDENT_NAV: NavItem[] = [
  { href: "/student/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/student/tracker", label: "Payment tracker", icon: "tracker" },
  { href: "/student/calendar", label: "Calendar", icon: "calendar" },
  { href: "/student/submit", label: "Submit receipt", icon: "upload" },
  { href: "/student/history", label: "History", icon: "history" },
  { href: "/student/notifications", label: "Notifications", icon: "bell" },
  { href: "/student/account", label: "My account", icon: "users" },
];
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/admin/monthly-review", label: "Monthly Payment Review", icon: "tracker" },
  { href: "/admin/students", label: "Students", icon: "users" },
  { href: "/admin/records", label: "Student records", icon: "calendar" },
  { href: "/admin/records?submission=pending_review&sort=submission_date", label: "Review queue", icon: "upload" },
  { href: "/admin/schedules", label: "Payment schedules", icon: "schedule" },
  { href: "/admin/notifications", label: "Notifications", icon: "bell" },
  { href: "/admin/email", label: "Email delivery", icon: "mail" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    tracker: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="18" r="2" /></>,
    calendar: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M7 2.5v4M17 2.5v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    schedule: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2M8 2v3M16 2v3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" /></>,
  };
  return <svg className="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function PortalShell({ portal, name, unread = 0, children }: { portal: "student" | "admin"; name: string; unread?: number; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nav = portal === "admin" ? ADMIN_NAV : STUDENT_NAV;
  const navLabel = portal === "admin" ? "Administrator navigation" : "Student navigation";

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    if (pathname === "/admin/records" && base === "/admin/records") {
      return href.includes("submission=")
        ? searchParams.get("submission") === "pending_review"
        : searchParams.get("submission") !== "pending_review";
    }
    return pathname === base || (base !== "/admin/dashboard" && base !== "/student/dashboard" && pathname.startsWith(`${base}/`));
  };

  const renderNav = (className: string) => (
    <nav className={className} aria-label={navLabel}>
      {nav.map((item) => {
        const active = isActive(item.href);
        return (
          <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="nav-icon"><Icon name={item.icon} /></span><span>{item.label}</span>
            {item.href.endsWith("notifications") && unread > 0 && <span className="badge-count" aria-label={`${unread} unread notifications`}>{unread}</span>}
            <LinkPendingIndicator />
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark" aria-label="PNPay-H portal home"><BrandMark /></Link>
        <div className="sidebar-kicker">{portal === "admin" ? "Admin workspace" : "Student space"}</div>
        {renderNav("side-nav")}
        <div className="sidebar-bottom">
          <div className="mini-card"><span className="mini-card-spark" aria-hidden="true">+</span><strong>{portal === "admin" ? "Keep payments moving." : "Stay on track."}</strong><span>{portal === "admin" ? "Review receipts before the next deadline." : "Your next payment is only a glance away."}</span></div>
          <form action={logoutAction}><input type="hidden" name="portal" value={portal} /><SubmitButton className="logout-link" pending="Signing out…"><Icon name="logout" /> Log out</SubmitButton></form>
        </div>
      </aside>
      <div className="page-column">
        <header className="mobile-topbar">
          <Link href={portal === "admin" ? "/admin/dashboard" : "/student/dashboard"} className="brand-mark" aria-label="PNPay-H portal home"><BrandMark /></Link>
          <div className="mobile-topbar-right">
            <div className="mobile-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="mobile-user-name">{name}</span></div>
            <form action={logoutAction} className="mobile-logout-form"><input type="hidden" name="portal" value={portal} /><SubmitButton className="mobile-logout" pending="…" ariaLabel="Log out"><Icon name="logout" /></SubmitButton></form>
          </div>
          {renderNav("mobile-nav")}
        </header>
        <main className="container">
          <div className="page-heading"><div><span className="eyebrow">{portal === "admin" ? "Administrator portal" : "Student portal"}</span><span className="heading-rule" /></div><div className="desktop-user"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></div></div>
          {children}
        </main>
      </div>
    </div>
  );
}
