import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AppHeader from "@/components/app-header";
import BottomNav from "@/components/bottom-nav";
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
  title: "Hot Takes",
  description: "An anonymous opinion board. Post it, vote it, argue about it.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        Bottom padding clears the fixed navigation, which is rendered here so the
        composer is one tap away from every page rather than only the feed.
      */}
      <body className="flex min-h-full flex-col pb-20">
        {/*
          The header reads the feed from the URL via useSearchParams, which needs
          a Suspense boundary when rendered from a layout.
        */}
        <Suspense fallback={<div className="h-14" />}>
          <AppHeader />
        </Suspense>
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
