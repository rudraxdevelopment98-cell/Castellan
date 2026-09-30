import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
