export default function BrandMark() {
  return (
    <>
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 42 42" fill="none">
          <rect x="2" y="2" width="30" height="30" rx="9" fill="#009DE1" />
          <path d="M10 12h13M10 18h9M10 24h6" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="30" cy="30" r="10" fill="#FF9933" />
          <path d="m25.5 30 3 3 6-7" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="brand-word">PNPay<span>-H</span></span>
    </>
  );
}
