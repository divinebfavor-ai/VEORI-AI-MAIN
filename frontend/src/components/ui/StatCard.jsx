import React from 'react'
import clsx from 'clsx'

export default function StatCard({ value, label, accent = 'green', sub, className = '' }) {
  const colors = {
    green: 'text-primary',
    gold:  'text-gold',
    white: 'text-text-primary',
    red:   'text-danger',
    amber: 'text-warning',
  }

  return (
    <div className={clsx(
      'bg-card border border-border-subtle rounded-lg p-6 flex flex-col gap-3',
      className
    )}>
      <p className="label-caps">{label}</p>
      <p className={clsx('text-[56px] font-bold leading-none tracking-tight', colors[accent] || colors.white)}>
        {value ?? '—'}
      </p>
      {sub && <p className="text-[13px] text-text-muted">{sub}</p>}
    </div>
  )
}
