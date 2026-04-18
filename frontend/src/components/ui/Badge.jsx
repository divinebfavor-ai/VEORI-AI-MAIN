import React from 'react'
import clsx from 'clsx'

const variants = {
  green:  { bg: 'bg-primary/10',  text: 'text-primary',        dot: 'bg-primary' },
  amber:  { bg: 'bg-warning/10',  text: 'text-warning',        dot: 'bg-warning' },
  red:    { bg: 'bg-danger/10',   text: 'text-danger',         dot: 'bg-danger' },
  gold:   { bg: 'bg-gold/10',     text: 'text-gold',           dot: 'bg-gold' },
  white:  { bg: 'bg-white/5',     text: 'text-text-primary',   dot: 'bg-text-primary' },
  gray:   { bg: 'bg-white/5',     text: 'text-text-secondary', dot: 'bg-text-muted' },
  // legacy aliases
  yellow: { bg: 'bg-warning/10',  text: 'text-warning',        dot: 'bg-warning' },
  blue:   { bg: 'bg-primary/10',  text: 'text-primary',        dot: 'bg-primary' },
  orange: { bg: 'bg-warning/10',  text: 'text-warning',        dot: 'bg-warning' },
}

export default function Badge({ variant = 'gray', children, dot = true, className = '' }) {
  const v = variants[variant] || variants.gray
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-[11px] font-medium tracking-wide',
      v.bg, v.text, className
    )}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', v.dot)} />}
      {children}
    </span>
  )
}
