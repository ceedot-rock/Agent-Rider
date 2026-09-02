import type { CSSProperties } from "react";

export function RiderMark({
  size = 36,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <img
      src="https://www.slidphilabs.com/assets/logos/logo-agent-rider.jpg"
      alt="Agent^Rider"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        boxShadow: "inset 0 0 0 1px #c4a35a",
        ...style,
      }}
    />
  );
}
