import type { CSSProperties } from "react";

const strip: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--muted)",
  background: "var(--panel)",
  border: "1px solid var(--line, rgba(196,163,90,0.35))",
  borderRadius: 8,
  padding: "10px 12px",
  margin: "0 0 18px",
};

const items = [
  "DEED is the ingest name. The schema is not this strip.",
  "Rider JWT is 900 seconds. A new token is a remint, not a longer token.",
  "Extended rider stays off unless an exactness PASS is bound.",
  "Receipt flags default off.",
  "Credit hop stays 410 until funded.",
  "No new SKU on this screen.",
];

export function DeskHonestyStrip() {
  return (
    <aside style={strip} aria-label="Desk honesty">
      {items.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </aside>
  );
}
