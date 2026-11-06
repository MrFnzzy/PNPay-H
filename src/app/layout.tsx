import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PNPay-H", template: "%s · PNPay-H" },
  description: "Student payment record and receipt verification system",
  robots: { index: false, follow: false },
};

const FONTS_URL = "https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded from the page head (not a CSS @import), so the browser fetches fonts in parallel with the stylesheet. display=swap shows text immediately. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body>{children}</body>
    </html>
  );
}
