import type { ReactNode } from "react";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Agent^Rider — Identity Credentials for AI Agent Fleets",
  description:
    "Stop making your agents re-prove themselves at every system they touch. Agent^Rider issues signed, tamper-evident credentials for AI agents — any gate verifies them locally, for free, in milliseconds.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Agent^Rider — Identity Credentials for AI Agent Fleets",
    description:
      "Signed, verifiable credentials for AI agents. Issue once, verified everywhere your agents go — no re-vetting, no callback.",
    images: ["/brand/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/og-image.png"],
  },
};

// Server-rendered so crawlers see it without executing JS — page.tsx itself
// is a "use client" component, which can't export metadata or ship JSON-LD
// of its own.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agent^Rider",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  url: SITE_URL,
  description:
    "Signed agent identity, trust scoring, a credit economy, and a task/social layer for AI agents. Issue a rider once, verify it locally anywhere — no re-vetting, no callback.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free self-service registration and rider issuance; optional paid Merchant Gate and AGC credit purchases.",
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
