import React from 'react'

/*
  Veori Glass Badge
  Colors: green | amber | red | gold | gray | white
  + legacy aliases: yellow | blue | orange
*/

const V = {
  green: { bg: 'rgba(0,195,122,0.12)',    text: '#00C37A',  border: 'rgba(0,195,122,0.25)' },
  amber: { bg: 'rgba(255,149,0,0.12)',    text: '#FF9500',  border: 'rgba(255,149,0,0.25)' },
  red:   { bg: 'rgba(255,68,68,0.12)',    text: '#FF4444',  border: 'rgba(255,68,68,0.25)' },
  gold:  { bg: 'rgba(201,168,76,0.12)',   text: '#C9A84C',  border: 'rgba(201,168,76,0.25)' },
  gray:  { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.40)', border: 'rgba(255,255,255,0.10)' },
  white: { bg: 'rgba(255,255,255,0.07)', text: 'rgba(255,255,255,0.80)', border: 'rgba(255,255,255,0.14)' },
  // legacy aliases
  yellow: { bg: 'rgba(255,149,0,0.12)', text: '#FF9500', border: 'rgba(255,149,0,0.25)' },
  blue:   { bg: 'rgba(0,195,122,0.12)', text: '#00C37A', border: 'rgba(0,195,122,0.25)' },
  orange: { bg: 'rgba(255,149,0,0.12)', text: '#FF9500', border: 'rgba(255,149,0,0.25)' },
}

export default function Badge({
  variant = 'gray', children,
  dot = false, className = '',
  style: extra = {},
}) {
  const c = V[variant] || V.gray
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      style={{
        fontSize: 10, fontWeight: 600,
        letterSpacing: '0.07em', textTransform: 'uppercase',
        lineHeight: 1, padding: '3px 7px',
        borderRadius: 5,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        whiteSpace: 'nowrap', flexShrink: 0,
        ...extra,
      }}
    >
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: c.text, flexShrink: 0, display: 'inline-block',
        }} />
      )}
      {children}
    </span>
  )
}
