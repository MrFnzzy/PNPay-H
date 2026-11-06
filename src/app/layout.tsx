import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no render-blocking request to fonts.googleapis.com on every first visit).
const lexend = Lexend({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-lexend" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-source" });

export const metadata: Metadata = {
  title: { default: "PNPay-H", template: "%s · PNPay-H" },
  description: "Student payment record and receipt verification system",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
