"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function RiderMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ margin: "0 auto 24px" }}>
      <circle cx="50" cy="50" r="48" fill="#000000" stroke="#C9A24A" strokeWidth="2" />
      <circle cx="50" cy="50" r="34" fill="#D61B1C" />
      <path d="M50 26 L68 62 H32 Z" fill="#F5F5F0" />
      <circle cx="50" cy="50" r="48" fill="none" stroke="#C9A24A" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

export default function Success() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing session — if you just paid, refresh this page.");
      setLoading(false);
      return;
    }
    fetch(`/api/provision?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Provisioning failed");
        setKey(data.merchantKey);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "80px 24px",
        textAlign: "center",
      }}
    >
      <RiderMark size={56} />
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        Merchant Gate is active
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32 }}>
        Your subscription is live. Here's your merchant API key — store it
        somewhere safe, it won't be shown again.
      </p>

      {loading && <p style={{ color: "var(--muted)" }}>Provisioning your key…</p>}

      {error && (
        <p style={{ color: "var(--crimson)" }}>
          {error} If you were charged, email support and we'll issue it
          manually.
        </p>
      )}

      {key && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--panel-line)",
            borderRadius: 8,
            padding: "18px 20px",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            wordBreak: "break-all",
            textAlign: "left",
          }}
        >
          {key}
        </div>
      )}

      <a
        href="/"
        style={{
          display: "inline-block",
          marginTop: 32,
          fontSize: 14,
          color: "var(--gold)",
        }}
      >
        ← Back to Agent^Rider
      </a>
    </main>
  );
}
