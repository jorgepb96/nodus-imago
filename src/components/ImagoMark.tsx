import { useId } from "react";
// Follows NodusHeaderLogo's theme-aware gradient and connected-node geometry.
export function ImagoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient
          id={id}
          x1="12"
          y1="10"
          x2="52"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--a-200)" />
          <stop offset=".45" stopColor="var(--a-400)" />
          <stop offset="1" stopColor="var(--a-600)" />
        </linearGradient>
      </defs>
      <g
        stroke={`url(#${id})`}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 9 52 21 52 43 32 55 12 43 12 21Z" />
        <path
          d="m32 9 13 26-26 0 13-26m20 12H25l13 23 14-23M12 21l13 23 13-23H12"
          strokeWidth="2.7"
        />
      </g>
      {[
        [32, 9],
        [52, 21],
        [52, 43],
        [32, 55],
        [12, 43],
        [12, 21],
      ].map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="3.7"
          fill={`var(--a-${[200, 300, 400, 600, 500, 300][i]})`}
        />
      ))}
    </svg>
  );
}
