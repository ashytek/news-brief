import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "News Brief",
  description: "Your adaptive intelligence digest",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches manifest.json's theme_color — tints the Android status bar /
  // recent-apps card instead of leaving it default white.
  themeColor: "#030712",
  // Lets env(safe-area-inset-*) resolve to real values on notch/gesture-nav
  // devices instead of always reading 0 — needed for the bottom nav and FAB
  // to actually clear the gesture bar rather than sit under it.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
