"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LandingBrand from "./LandingBrand";
import { ArrowRightIcon } from "./icons";

const LINKS = [
  { id: "benefits", label: "Benefits" },
  { id: "how", label: "How it works" },
  { id: "statuses", label: "Statuses" },
  { id: "faq", label: "FAQ" },
];

/** Floating, translucent navigation bar with a full height mobile menu. */
export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  // Mark the section in view in the navigation (IntersectionObserver, no scroll listener).
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = ["top", ...LINKS.map((l) => l.id), "start"];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id === "top" || e.target.id === "start" ? "" : e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  // Lock page scroll while the menu is open, close on Escape and when the viewport grows to desktop width.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 768px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className="lp-nav-wrap">
        <nav className="lp-nav" aria-label="Primary">
          <Link href="/" className="lp-nav-brand" aria-label="PNPay-H home" onClick={close}>
            <LandingBrand />
          </Link>
          <ul className="lp-nav-links">
            {LINKS.map((l) => (
              <li key={l.id}>
                <a href={`#${l.id}`} className="lp-nav-link title-4" aria-current={active === l.id ? "location" : undefined}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/login" className="lp-btn lp-btn-ghost lp-nav-signin button-sm">
            Sign in
          </Link>
          <button
            type="button"
            className="lp-toggle"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="lp-toggle-bar" />
            <span className="lp-toggle-bar" />
            <span className="lp-toggle-bar" />
          </button>
        </nav>
      </header>

      <div id="lp-menu" className={`lp-menu${open ? " is-open" : ""}`} aria-hidden={!open}>
        <ul className="lp-menu-list">
          {LINKS.map((l, i) => (
            <li key={l.id} style={{ ["--i" as string]: i }}>
              <a href={`#${l.id}`} className="lp-menu-link heading-5" onClick={close} aria-current={active === l.id ? "location" : undefined}>
                {l.label}
              </a>
            </li>
          ))}
          <li style={{ ["--i" as string]: LINKS.length }} className="lp-menu-actions">
            <Link href="/register" className="lp-btn lp-btn-primary button-md" onClick={close}>
              Create your account <ArrowRightIcon className="lp-icon" />
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost button-md" onClick={close}>
              Sign in
            </Link>
          </li>
          <li style={{ ["--i" as string]: LINKS.length + 1 }}>
            <Link href="/admin/login" className="lp-menu-admin caption-1" onClick={close}>
              Administrator access
            </Link>
          </li>
        </ul>
      </div>
    </>
  );
}
