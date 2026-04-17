import React from 'react'
import clsx from 'clsx'

const variants = {
  green: { dot: 'bg-success', text: 'text-success', bg: 'bg-success/10' },
  yellow: { dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  red: { dot: 'bg-danger', text: 'text-danger', bg: 'bg-danger/10' },
  blue: { dot: 'bg-primary', text: 'text-primary', bg: 'bg-primary/10' },
  orange: { dot: 'bg-hot', text: 'text-hot', bg: 'bg-hot/10' },
  gray: { dot: 'bg-text-muted', text: 'text-text-secondary', bg: 'bg-text-muted/10' },
}

export default function Badge({ variant = 'gray', children, className = '' }) {
  const v = variants[variant] || variants.gray
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
        v.bg,
        v.text,
        className
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', v.dot)} />
      {children}
    </span>
  )
}
