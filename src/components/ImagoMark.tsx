import { useId } from "react";
// Compact version of the objective mark. The N uses the same canonical
// geometry, stroke and four nodes as Nodus Research, scaled uniformly.
export function ImagoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient
          id={id}
          x1="14"
          y1="10"
          x2="50"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--a-200)" />
          <stop offset=".45" stopColor="var(--a-400)" />
          <stop offset="1" stopColor="var(--a-600)" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="28.5" fill="none" stroke={`url(#${id})`} strokeWidth="2.4" />
      <circle cx="32" cy="32" r="24.5" fill="none" stroke="var(--a-300)" strokeOpacity=".38" strokeWidth="1.2" />
      <path
        d="M18 48V16L46 48V16"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="16" r="6.5" fill="var(--a-200)" />
      <circle cx="18" cy="48" r="6.5" fill="var(--a-400)" />
      <circle cx="46" cy="48" r="6.5" fill="var(--a-500)" />
      <circle cx="46" cy="16" r="6.5" fill="var(--a-600)" />
    </svg>
  );
}
