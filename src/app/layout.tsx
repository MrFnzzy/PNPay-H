import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PNPay-H", template: "%s · PNPay-H" },
  description: "Student payment record and receipt verification system",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
