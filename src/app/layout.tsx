import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "Castellan",
  description:
    "Read every document once, turn it into dated obligations, and know exactly what needs doing today. For UK landlords and any business that tracks documents and deadlines.",
};

export const viewport: Viewport = {
  themeColor: "#2e5b4f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <div className="hidden md:flex">
            <Suspense fallback={<div className="w-56 border-r border-rule bg-surface" />}>
              <Sidebar />
            </Suspense>
          </div>
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
        </div>
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      </body>
    </html>
  );
}
