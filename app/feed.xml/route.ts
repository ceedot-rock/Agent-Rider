import { NextResponse } from 'next/server'

export async function GET() {
  const domain = 'https://agentrider.vercel.app'
  
  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>AgentRider — AI Builders On-Chain</title>
  <link>${domain}</link>
  <description>A tight broadcast for AI-native crypto builders — agents, infra, and innovation from people shipping at the edge.</description>
  <language>en-us</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${domain}/feed.xml" rel="self" type="application/rss+xml" />
  <item>
    <title>Episode 01: The Builder Stack — Shipping AI Agents On-Chain</title>
    <link>${domain}/ep01-builder-stack</link>
    <guid isPermaLink="true">${domain}/ep01-builder-stack</guid>
    <pubDate>Mon, 21 Jul 2026 09:00:00 GMT</pubDate>
    <description><![CDATA[We break down the modern AI builder stack in crypto: LLM orchestration + tool-use, wallet-native agents, on-chain memory with vector DBs, and verifiable inference. Featuring patterns from teams using Eliza, Bittensor subnets, and Base agents.]]></description>
  </item>
  <item>
    <title>Episode 02: From Prompt to Protocol — How AI Builders Are Rewiring Innovation</title>
    <link>${domain}/ep02-prompt-to-protocol</link>
    <guid isPermaLink="true">${domain}/ep02-prompt-to-protocol</guid>
    <pubDate>Tue, 22 Jul 2026 09:00:00 GMT</pubDate>
    <description><![CDATA[How top AI builders are turning prompts into protocols. Autonomous trading agents that self-fund, AI launchpads that evaluate builders instead of pitch decks, and why provenance + compute markets are the next unlock.]]></description>
  </item>
</channel>
</rss>`

  return new NextResponse(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  })
}
