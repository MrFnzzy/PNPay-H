/** Brand lockup used on the public pages. Same mark as BrandMark, set in the landing typeface. */
export default function LandingBrand() {
  return (
    <span className="lp-brand">
      <svg className="lp-brand-mark" viewBox="0 0 42 42" fill="none" aria-hidden="true" focusable="false">
        <rect x="2" y="2" width="30" height="30" rx="9" fill="#22BBEA" />
        <path d="M10 12h13M10 18h9M10 24h6" stroke="#172C35" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="30" cy="30" r="10" fill="#FF9933" />
        <path d="m25.5 30 3 3 6-7" stroke="#172C35" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="lp-brand-word">PNPay<span>-H</span></span>
    </span>
  );
}
