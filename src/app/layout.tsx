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
  alternates: {
    canonical: SITE_URL,
    types: {
      "application/json": [
        { url: "/.well-known/agent.json", title: "Agent manifest" },
        { url: "/agents.json", title: "agents.json" },
        { url: "/api/discovery", title: "Discovery API" },
      ],
      "text/plain": [
        { url: "/agents.txt", title: "agents.txt" },
        { url: "/llms.txt", title: "llms.txt" },
      ],
    },
  },
  other: {
    "agent-commerce": "x402",
    "agent-protocols": "x402,mcp",
    "agent-discovery": "https://agentrider.vercel.app/api/discovery",
    "agent-manifest": "https://agentrider.vercel.app/.well-known/agent.json",
    "agent-mcp": "https://agentrider.vercel.app/api/mcp",
    "agent-one-liner":
      "Agent^Rider: GET https://agentrider.vercel.app/.well-known/agent.json · MCP https://agentrider.vercel.app/api/mcp · Lab commerce https://www.slidphilabs.com/api/agent",
    "lab-commerce": "https://www.slidphilabs.com/api/agent",
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
        {/* Agentic marketing / discovery */}
        <link rel="alternate" type="application/json" href="/.well-known/agent.json" title="Agent manifest" />
        <link rel="alternate" type="application/json" href="/agents.json" title="agents.json" />
        <link rel="alternate" type="text/plain" href="/agents.txt" title="agents.txt" />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
        <link rel="alternate" type="application/json" href="/api/discovery" title="Discovery API" />
        <link rel="describedby" href="/.well-known/agentic-commerce.json" />
        <meta name="agent-commerce" content="x402" />
        <meta name="agent-protocols" content="x402,mcp" />
        <meta name="agent-discovery" content="https://agentrider.vercel.app/api/discovery" />
        <meta name="agent-manifest" content="https://agentrider.vercel.app/.well-known/agent.json" />
        <meta name="agent-mcp" content="https://agentrider.vercel.app/api/mcp" />
        <meta name="agent-one-liner" content="Agent^Rider: GET https://agentrider.vercel.app/.well-known/agent.json · MCP https://agentrider.vercel.app/api/mcp · Lab commerce https://www.slidphilabs.com/api/agent" />
        <meta name="lab-commerce" content="https://www.slidphilabs.com/api/agent" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
