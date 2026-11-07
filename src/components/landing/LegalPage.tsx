import Link from "next/link";
import type { ReactNode } from "react";
import "@/app/landing.css";
import LandingBrand from "./LandingBrand";
import { ArrowRightIcon } from "./icons";

/** Shared frame for the privacy and terms pages. */
export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lp">
      <a className="lp-skip button-sm" href="#main">Skip to content</a>
      <header className="lp-page-head">
        <div className="lp-container">
          <Link href="/" aria-label="PNPay-H home" className="lp-nav-brand"><LandingBrand /></Link>
          <Link href="/" className="lp-btn lp-btn-ghost button-sm">Back to home <ArrowRightIcon className="lp-icon" /></Link>
        </div>
      </header>
      <main id="main" className="lp-doc">
        <div className="lp-container">
          <article className="lp-doc-inner">
            <h1 className="heading-3">{title}</h1>
            {children}
          </article>
        </div>
      </main>
    </div>
  );
}
