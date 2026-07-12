import type { CSSProperties } from "react";

export function RiderMark({
  size = 36,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={style}>
      <circle cx="50" cy="50" r="48" fill="#000000" stroke="#C9A24A" strokeWidth="2" />
      <circle cx="50" cy="50" r="34" fill="#D61B1C" />
      <path d="M50 26 L68 62 H32 Z" fill="#F5F5F0" />
      <circle cx="50" cy="50" r="48" fill="none" stroke="#C9A24A" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}
