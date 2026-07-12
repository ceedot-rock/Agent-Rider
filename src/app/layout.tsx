import type { ReactNode } from "react";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Agent^Rider — Portable trust for AI agents",
  description:
    "One verification, carried everywhere. Agent^Rider issues a signed credential your agents present at every gate — no re-checking identity at every network they touch.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Agent^Rider — Portable trust for AI agents",
    description: "One verification, carried everywhere.",
    images: ["/brand/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
