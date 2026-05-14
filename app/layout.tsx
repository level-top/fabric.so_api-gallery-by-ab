import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import HeaderNav from "./components/HeaderNav";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getMetadataBase(): URL | undefined {
  const direct = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "").trim();
  if (direct) {
    try {
      return new URL(direct);
    } catch {
      // ignore
    }
  }

  return undefined;
}

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: "AB Designer",
  description: "Client gallery powered by DNL",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

function HeaderFallback() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        borderBottom: "1px solid rgba(127, 127, 127, 0.18)",
        background: "rgba(10, 10, 10, 0.92)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "14px 24px",
          fontFamily: "var(--font-geist-sans)",
          fontSize: 14,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(237, 237, 237, 0.78)",
        }}
      >
        AB Designer
      </div>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Suspense fallback={<HeaderFallback />}>
          <HeaderNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
