import React from 'react'

/**
 * Veori Logo Mark — overlapping ring design in brand colors
 * Green (#00C37A) + Gold (#C9A84C) on transparent background
 */
export default function VeoriLogo({ size = 32, className = '' }) {
  const id = `vl-${size}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* Green ring gradient */}
        <linearGradient id={`${id}-g1`} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00E57A" />
          <stop offset="100%" stopColor="#00A868" />
        </linearGradient>
        {/* Gold ring gradient */}
        <linearGradient id={`${id}-g2`} x1="100" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E8C266" />
          <stop offset="100%" stopColor="#B8922C" />
        </linearGradient>
        {/* Center glow */}
        <radialGradient id={`${id}-cg`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#A0FFD6" />
        </radialGradient>
        {/* Outer glow filter */}
        <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Ring 1 — green, axis-aligned */}
      <rect
        x="14" y="14" width="72" height="72" rx="22" ry="22"
        stroke={`url(#${id}-g1)`}
        strokeWidth="9"
        strokeLinecap="round"
        filter={`url(#${id}-glow)`}
      />

      {/* Ring 2 — gold, rotated 45° */}
      <rect
        x="14" y="14" width="72" height="72" rx="22" ry="22"
        stroke={`url(#${id}-g2)`}
        strokeWidth="9"
        strokeLinecap="round"
        transform="rotate(45 50 50)"
        filter={`url(#${id}-glow)`}
        opacity="0.92"
      />

      {/* Center dot */}
      <circle cx="50" cy="50" r="8" fill={`url(#${id}-cg)`} />
      <circle cx="50" cy="50" r="4" fill="#FFFFFF" />
    </svg>
  )
}
