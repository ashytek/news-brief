import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headline serif for the redesign (Newsreader 600; opsz is the optical-size
// axis the mockups use). Nothing renders in it yet, and preload:false keeps a
// ~100 KB font download off every page until a screen actually needs it —
// flip it on when the cards adopt `font-serif` (roadmap session 4).
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "News Brief",
  description: "Your adaptive intelligence digest",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "News Brief",
  },
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
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
