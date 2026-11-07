import type { Metadata } from "next";
import Link from "next/link";
import LandingBrand from "@/components/landing/LandingBrand";
import LandingNav from "@/components/landing/LandingNav";
import Reveal from "@/components/landing/Reveal";
import TaglineReveal from "@/components/landing/TaglineReveal";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BellRingingIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  ClockClockwiseIcon,
  ClockIcon,
  LockKeyIcon,
  PlusIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@/components/landing/icons";
import "./landing.css";

const TITLE = "PNPay-H: your counterpart payments, tracked and verified";
const DESCRIPTION =
  "See what is due each month, upload your receipt after you pay your ₱500, and follow the review from Pending verification to Paid. PNPay-H keeps records. It never handles your money.";

// Layout type A (classic hero plus sections). Indexing stays off: this is a school tool reached by
// links from the school, and the root layout already sets robots noindex.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "PNPay-H" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const PROBLEMS = [
  "Receipts scattered across chat threads and photo galleries",
  "No clear view of which month is next",
  "Waiting with no way to tell whether a receipt was seen",
];
const SOLUTIONS = [
  "Every receipt attached to the month it pays for",
  "A schedule, tracker and calendar showing what is due each month",
  "A status that changes as soon as your administrator reviews",
];

const BENEFITS = [
  { Icon: CalendarCheckIcon, title: "See what is due", body: "Open your schedule, tracker or monthly calendar to see every monthly payment and its due date." },
  { Icon: UploadSimpleIcon, title: "Send your receipt", body: "Upload a PNG or JPEG of your receipt and it attaches to the month you chose." },
  { Icon: CheckCircleIcon, title: "Follow the review", body: "Each monthly payment shows its status, from Pending verification to Paid, so you never have to ask." },
  { Icon: BellRingingIcon, title: "Get reminded", body: "Receive a notice in the app and by email before a monthly payment falls due." },
  { Icon: ClockClockwiseIcon, title: "Keep your history", body: "Look back at every receipt you submitted and how it was reviewed whenever you need proof." },
];

const STEPS = [
  { title: "Create your account", body: "Enter your name, ID, email and batch, then confirm your email with the link we send you." },
  { title: "Pay, then upload your receipt", body: "Pay your ₱500 the way you already do. Choose the month and upload the receipt." },
  { title: "Follow the review", body: "Your administrator verifies the receipt or asks for a correction. You are notified either way." },
];

const STATUSES = [
  { tone: "notdue", label: "Not yet due", body: "The monthly payment is scheduled and its due date has not passed." },
  { tone: "pending", label: "Pending verification", body: "You submitted a receipt and your administrator has not reviewed it yet." },
  { tone: "paid", label: "Paid", body: "Your administrator verified the receipt." },
  { tone: "resubmit", label: "Requires resubmission", body: "A correction was requested. Upload a new receipt for the same month." },
  { tone: "overdue", label: "Overdue", body: "The due date passed and no receipt is verified or waiting for review." },
];

const TRUST = [
  { Icon: LockKeyIcon, text: "Receipts are stored privately. Only you and your administrator can open them." },
  { Icon: ShieldCheckIcon, text: "PNPay-H records payments. It never processes or holds your money." },
  { Icon: WarningCircleIcon, text: "Statuses come from due dates and reviews, so nobody types them in by hand." },
];

const FAQ = [
  { q: "Does PNPay-H take my payment?", a: "No. You pay your ₱500 the way your program already collects it, then upload the receipt here. PNPay-H keeps the record and never handles your money." },
  { q: "Who reviews my receipt?", a: "Your administrator checks each receipt and verifies it, rejects it, or asks you for a correction." },
  { q: "What kind of file can I upload?", a: "A photo or screenshot of your receipt saved as a PNG or JPEG image." },
  { q: "What happens if my receipt needs a correction?", a: "The month moves to Requires resubmission and you get a notification. Upload a new receipt for the same month." },
  { q: "How will I know when something is due?", a: "Your schedule, tracker and calendar show every due date. You also get a reminder in the app and by email before a monthly payment falls due." },
  { q: "Do I need to confirm my email?", a: "Yes. After you register we send a link that confirms your email. If it does not arrive, you can ask for a new one on the resend page." },
  { q: "Who can see my receipts?", a: "You and your administrator. Receipts are kept in private storage and are never shown to other people." },
  { q: "Can I delete my account?", a: "Yes, from your account page after you sign in. Deleting removes your account, your scheduled payments, your receipts and your notifications for good, so it cannot be undone." },
];

export default function Home() {
  return (
    <div className="lp">
      <noscript>
        <style>{`.lp-reveal{opacity:1!important;transform:none!important}.lp-word{opacity:1!important}`}</style>
      </noscript>
      <a className="lp-skip button-sm" href="#main">Skip to content</a>
      <LandingNav />

      <main id="main">
        {/* HERO */}
        <section id="top" className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow caption-3 lp-rise" style={{ ["--d" as string]: "0ms" }}>
                <span className="lp-dot" aria-hidden="true" />
                Counterpart payment records
              </p>
              <h1 id="hero-title" className="heading-1 lp-gradient-text lp-rise" style={{ ["--d" as string]: "60ms" }}>
                <span className="lp-line">Counterpart payments,</span> <span className="lp-line">tracked and verified</span> <span className="lp-line">in one place</span>
              </h1>
              <p className="body-3 lp-lead lp-rise" style={{ ["--d" as string]: "120ms" }}>
                See what is due each month, upload your receipt after you pay your ₱500, and know the moment your administrator reviews it.
              </p>
              <div className="lp-hero-actions lp-rise" style={{ ["--d" as string]: "180ms" }}>
                <Link href="/register" className="lp-btn lp-btn-primary button-md">
                  Create your account <ArrowRightIcon className="lp-icon lp-icon-move" />
                </Link>
              </div>
              <p className="lp-proof caption-2 lp-rise" style={{ ["--d" as string]: "240ms" }}>
                <ShieldCheckIcon className="lp-icon" />
                Every receipt is checked by your administrator.
              </p>
            </div>

            <div className="lp-hero-art lp-rise" style={{ ["--d" as string]: "200ms" }} role="img" aria-label="Sample ledger showing 2,500 pesos remaining, 7 of 12 monthly payments made, with one verified, one pending and one upcoming payment">
              <div className="lp-ledger" aria-hidden="true">
                <div className="lp-ledger-top">
                  <span className="lp-ledger-title title-4">Counterpart ledger</span>
                  <span className="lp-chip caption-3">Sample view</span>
                </div>
                <div className="lp-ledger-summary">
                  <span className="caption-2 lp-muted">Remaining balance</span>
                  <strong className="heading-3 lp-num">₱2,500.00</strong>
                  <div className="lp-progress-head caption-1">
                    <span>Payments made</span>
                    <span className="lp-num">7 of 12</span>
                  </div>
                  <div className="lp-progress"><span className="lp-progress-fill" /></div>
                </div>
                <ul className="lp-rows">
                  <li className="lp-row">
                    <span className="lp-row-icon lp-tone-paid"><CheckCircleIcon className="lp-icon" /></span>
                    <span className="lp-row-text"><strong className="title-4">October payment</strong><small className="caption-2 lp-muted">Verified</small></span>
                    <span className="body-5 lp-num">₱500.00</span>
                  </li>
                  <li className="lp-row">
                    <span className="lp-row-icon lp-tone-pending"><ClockIcon className="lp-icon" /></span>
                    <span className="lp-row-text"><strong className="title-4">November payment</strong><small className="caption-2 lp-muted">Pending verification</small></span>
                    <span className="body-5 lp-num">₱500.00</span>
                  </li>
                  <li className="lp-row">
                    <span className="lp-row-icon lp-tone-notdue"><CalendarCheckIcon className="lp-icon" /></span>
                    <span className="lp-row-text"><strong className="title-4">December payment</strong><small className="caption-2 lp-muted">Not yet due</small></span>
                    <span className="body-5 lp-num">₱500.00</span>
                  </li>
                </ul>
              </div>
              <div className="lp-toast" aria-hidden="true">
                <span className="lp-row-icon lp-tone-paid"><CheckCircleIcon className="lp-icon" /></span>
                <span className="lp-row-text"><strong className="title-4">Receipt verified</strong><small className="caption-2 lp-muted">Your record is up to date</small></span>
              </div>
            </div>
          </div>
        </section>

        {/* PROBLEM TO SOLUTION */}
        <section id="problem" className="lp-section lp-alt" aria-labelledby="problem-title">
          <div className="lp-container">
            <Reveal>
              <div className="lp-head">
                <p className="lp-eyebrow caption-3"><span className="lp-dot" aria-hidden="true" />The problem</p>
                <h2 id="problem-title" className="heading-2">Stop digging through chats to prove you paid</h2>
                <p className="body-3 lp-sub">A payment is only useful if you can show it later. PNPay-H keeps each month's receipt next to the payment it belongs to.</p>
              </div>
            </Reveal>
            <div className="lp-compare">
              <Reveal>
                <div className="lp-card lp-card-white lp-compare-card">
                  <h3 className="heading-6">Without PNPay-H</h3>
                  <ul className="lp-list">
                    {PROBLEMS.map((t) => (
                      <li key={t} className="body-3"><WarningCircleIcon className="lp-icon lp-icon-warn" /><span>{t}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={80}>
                <div className="lp-card lp-card-white lp-compare-card lp-compare-good">
                  <h3 className="heading-6">With PNPay-H</h3>
                  <ul className="lp-list">
                    {SOLUTIONS.map((t) => (
                      <li key={t} className="body-3"><CheckCircleIcon className="lp-icon lp-icon-good" /><span>{t}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* BENEFITS */}
        <section id="benefits" className="lp-section" aria-labelledby="benefits-title">
          <div className="lp-container">
            <Reveal>
              <div className="lp-head">
                <p className="lp-eyebrow caption-3"><span className="lp-dot" aria-hidden="true" />Benefits</p>
                <h2 id="benefits-title" className="heading-2">Five things you can do the day you sign up</h2>
              </div>
            </Reveal>
            <div className="lp-benefits">
              {BENEFITS.map(({ Icon, title, body }, i) => (
                <Reveal key={title} delay={(i % 3) * 80} className={`lp-benefit lp-benefit-${i + 1}`}>
                  <div className="lp-card lp-card-tint">
                    <span className="lp-icon-chip"><Icon className="lp-icon" /></span>
                    <h3 className="title-1">{title}</h3>
                    <p className="body-3 lp-muted">{body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* TAGLINE REVEAL */}
        <section id="promise" className="lp-section lp-alt lp-promise" aria-label="Our promise">
          <div className="lp-container">
            <TaglineReveal lines={["Every monthly payment on record.", "Every receipt reviewed.", "Nothing left to guess."]} />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="lp-section" aria-labelledby="how-title">
          <div className="lp-container">
            <Reveal>
              <div className="lp-head">
                <p className="lp-eyebrow caption-3"><span className="lp-dot" aria-hidden="true" />How it works</p>
                <h2 id="how-title" className="heading-2">From sign up to Paid in three steps</h2>
              </div>
            </Reveal>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={i * 80}>
                    <div className="lp-card lp-card-tint lp-step">
                      <span className="lp-step-num heading-6" aria-hidden="true">{i + 1}</span>
                      <h3 className="title-1">{s.title}</h3>
                      <p className="body-3 lp-muted">{s.body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* STATUSES AND TRUST (proof) */}
        <section id="statuses" className="lp-section lp-alt" aria-labelledby="statuses-title">
          <div className="lp-container">
            <Reveal>
              <div className="lp-head">
                <p className="lp-eyebrow caption-3"><span className="lp-dot" aria-hidden="true" />Clear rules</p>
                <h2 id="statuses-title" className="heading-2">What each status means</h2>
                <p className="body-3 lp-sub">Every monthly payment shows exactly one of these five statuses, so you always know your next move.</p>
              </div>
            </Reveal>
            <div className="lp-proof-grid">
              <Reveal>
                <ul className="lp-card lp-card-white lp-status-list">
                  {STATUSES.map((s) => (
                    <li key={s.label} className="lp-status">
                      <span className={`lp-pill caption-1 lp-tone-${s.tone}`}><span className="lp-pill-dot" aria-hidden="true" />{s.label}</span>
                      <span className="body-6 lp-muted">{s.body}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={80}>
                <div className="lp-card lp-card-white lp-trust">
                  <h3 className="heading-6">Built to be trusted</h3>
                  <ul className="lp-list">
                    {TRUST.map(({ Icon, text }) => (
                      <li key={text} className="body-3"><Icon className="lp-icon lp-icon-good" /><span>{text}</span></li>
                    ))}
                  </ul>
                  {/* {{testimonial}}: add a real quote here once the program owner approves one. */}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="lp-section" aria-labelledby="faq-title">
          <div className="lp-container lp-faq-wrap">
            <Reveal>
              <div className="lp-head">
                <p className="lp-eyebrow caption-3"><span className="lp-dot" aria-hidden="true" />FAQ</p>
                <h2 id="faq-title" className="heading-2">Questions people ask</h2>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="lp-faq">
                {FAQ.map((f) => (
                  <details key={f.q} className="lp-faq-item" name="faq">
                    <summary className="lp-faq-q title-2">
                      <span>{f.q}</span>
                      <PlusIcon className="lp-icon lp-faq-plus" />
                    </summary>
                    <p className="lp-faq-a body-3 lp-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* RISK REVERSAL + FINAL CTA */}
        <section id="start" className="lp-cta" aria-labelledby="cta-title">
          <div className="lp-container">
            <Reveal>
              <div className="lp-cta-inner">
                <h2 id="cta-title" className="heading-2">See what is due and what is verified</h2>
                <p className="body-3 lp-cta-sub">No card or wallet details are needed. PNPay-H only keeps records, so there is nothing to cancel.</p>
                <div className="lp-hero-actions">
                  <Link href="/register" className="lp-btn lp-btn-dark button-md">
                    Create your account <ArrowRightIcon className="lp-icon lp-icon-move" />
                  </Link>
                </div>
                <p className="caption-1 lp-cta-signin">
                  Already registered? <Link href="/login" className="lp-link">Sign in</Link>
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <Link href="/" aria-label="PNPay-H home"><LandingBrand /></Link>
            <p className="caption-2 lp-muted">PNPay-H records payments. It does not process them.</p>
          </div>
          <nav className="lp-footer-links" aria-label="Footer">
            <Link href="/login" className="body-5 lp-link">Sign in</Link>
            <Link href="/register" className="body-5 lp-link">Create account</Link>
            <Link href="/resend-verification" className="body-5 lp-link">Resend verification email</Link>
            <Link href="/privacy" className="body-5 lp-link">Privacy</Link>
            <Link href="/terms" className="body-5 lp-link">Terms</Link>
            <Link href="/admin/login" className="body-5 lp-link">Administrator access <ArrowUpRightIcon className="lp-icon" /></Link>
            <a href="#top" className="body-5 lp-link">Back to top</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
