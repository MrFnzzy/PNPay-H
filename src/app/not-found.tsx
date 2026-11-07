import Link from "next/link";
import LandingBrand from "@/components/landing/LandingBrand";
import { ArrowRightIcon } from "@/components/landing/icons";
import "./landing.css";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="lp lp-notfound">
      <main className="lp-notfound-card">
        <LandingBrand />
        <h1 className="heading-4">This page could not be found</h1>
        <p className="body-3 lp-muted">The link may be old or mistyped. Go back to the home page or sign in to your account.</p>
        <div className="lp-hero-actions">
          <Link href="/" className="lp-btn lp-btn-primary button-md">Back to home <ArrowRightIcon className="lp-icon" /></Link>
          <Link href="/login" className="lp-btn lp-btn-ghost button-md">Sign in</Link>
        </div>
      </main>
    </div>
  );
}
