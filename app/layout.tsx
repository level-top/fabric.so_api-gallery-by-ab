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

  // Vercel provides VERCEL_URL as host (no protocol).
  const vercel = (process.env.VERCEL_URL ?? "").trim();
  if (vercel) {
    try {
      return new URL(`https://${vercel}`);
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Suspense fallback={null}>
          <HeaderNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
