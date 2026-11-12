import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cormorant_Garamond, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and served from our own origin: no
// request to a third party at runtime, and no exception needed in the CSP.
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Castellan",
  description:
    "A multi-tenant operations platform: records, documents, dated obligations, teams, reminders and answers — shaped around your own data.",
};

export const viewport: Viewport = {
  themeColor: "#2e5b4f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, which the nonce
  // based Content-Security-Policy (src/middleware.ts) requires: a page built
  // ahead of time has no request, so its scripts could not carry a nonce.
  await headers();
  return (
    <html lang="en-GB" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
