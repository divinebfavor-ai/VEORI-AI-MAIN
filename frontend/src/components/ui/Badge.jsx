import React from 'react'

/*
  No dot — background color IS the status signal.
  10px / 600 / uppercase / border-radius: 4px
  Each color means exactly one thing:
    green — live / active / success
    amber — warning / paused / warm lead
    red   — error / DNC / cold
    gold  — money / deal / closed
    gray  — neutral / new / unknown
*/

const V = {
  green: { bg: 'rgba(0,229,122,0.12)',    text: 'var(--green)', border: 'rgba(0,229,122,0.22)' },
  amber: { bg: 'rgba(255,140,0,0.12)',    text: 'var(--amber)', border: 'rgba(255,140,0,0.22)' },
  red:   { bg: 'rgba(255,59,78,0.12)',    text: 'var(--red)',   border: 'rgba(255,59,78,0.22)' },
  gold:  { bg: 'rgba(212,168,67,0.12)',   text: 'var(--gold)',  border: 'rgba(212,168,67,0.22)' },
  gray:  { bg: 'rgba(255,255,255,0.06)',  text: 'var(--t3)',    border: 'var(--border-rest)' },
  white: { bg: 'rgba(255,255,255,0.06)',  text: 'var(--t1)',    border: 'var(--border-rest)' },
  // legacy aliases
  yellow: { bg: 'rgba(255,140,0,0.12)',   text: 'var(--amber)', border: 'rgba(255,140,0,0.22)' },
  blue:   { bg: 'rgba(0,229,122,0.12)',   text: 'var(--green)', border: 'rgba(0,229,122,0.22)' },
  orange: { bg: 'rgba(255,140,0,0.12)',   text: 'var(--amber)', border: 'rgba(255,140,0,0.22)' },
}

export default function Badge({
  variant   = 'gray',
  children,
  dot       = false,  // dot disabled by default in new design
  className = '',
  style: extra = {},
}) {
  const v = V[variant] || V.gray
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        lineHeight: 1,
        padding: '3px 7px',
        borderRadius: 4,
        background: v.bg,
        color: v.text,
        border: `1px solid ${v.border}`,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...extra,
      }}
    >
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: v.text, flexShrink: 0, display: 'inline-block',
        }} />
      )}
      {children}
    </span>
  )
}
