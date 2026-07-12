"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RiderMark } from "@/components/RiderMark";

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
      <RiderMark size={56} style={{ margin: "0 auto 24px" }} />
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
