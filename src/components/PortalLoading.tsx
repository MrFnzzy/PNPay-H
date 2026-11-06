import BrandMark from "@/components/BrandMark";

type Portal = "admin" | "student";

export default function PortalLoading({ portal }: { portal: Portal }) {
  const label = portal === "admin" ? "administrator" : "student";
  return (
    <div className="app-frame portal-loading" aria-busy="true">
      <p className="loading-status" role="status" aria-live="polite">Loading {label} workspace…</p>
      <aside className="sidebar" aria-hidden="true">
        <div className="brand-mark"><BrandMark /></div>
        <div className="sidebar-kicker">{portal === "admin" ? "Admin workspace" : "Student space"}</div>
        <div className="side-nav">
          {Array.from({ length: portal === "admin" ? 7 : 5 }, (_, index) => <span key={index} className="loading-skeleton loading-nav-row" />)}
        </div>
        <div className="sidebar-bottom"><span className="loading-skeleton loading-promo" /></div>
      </aside>
      <div className="page-column">
        <header className="mobile-topbar" aria-hidden="true">
          <div className="brand-mark"><BrandMark /></div>
          <div className="mobile-topbar-right"><span className="loading-skeleton loading-avatar" /></div>
          <nav className="mobile-nav">
            {Array.from({ length: portal === "admin" ? 5 : 4 }, (_, index) => <span key={index} className="loading-skeleton loading-mobile-nav" />)}
          </nav>
        </header>
        <main className="container" aria-hidden="true">
          <div className="page-heading">
            <div><span className="eyebrow">{portal === "admin" ? "Administrator portal" : "Student portal"}</span><span className="heading-rule" /></div>
            <span className="loading-skeleton loading-avatar" />
          </div>
          <span className="loading-skeleton loading-title" />
          <div className="stats">
            {Array.from({ length: 4 }, (_, index) => <span key={index} className="loading-skeleton loading-stat" />)}
          </div>
          <section className="card loading-panel">
            <span className="loading-skeleton loading-line loading-line-title" />
            <span className="loading-skeleton loading-line" />
            <span className="loading-skeleton loading-line loading-line-short" />
            <span className="loading-skeleton loading-wide" />
          </section>
        </main>
      </div>
    </div>
  );
}
