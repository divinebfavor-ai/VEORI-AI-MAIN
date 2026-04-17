import React from 'react'
import clsx from 'clsx'

export default function StatCard({ value, label, icon: Icon, trend, trendLabel, className = '' }) {
  const isPositive = trend && !String(trend).startsWith('-')

  return (
    <div className={clsx('bg-card border border-border-subtle rounded-xl p-6 relative', className)}>
      {Icon && (
        <div className="absolute top-4 right-4 text-text-muted">
          <Icon size={20} />
        </div>
      )}
      <div className="text-5xl font-bold text-text-primary tracking-tight leading-none mb-1">
        {value ?? '—'}
      </div>
      <div className="text-xs text-text-secondary mt-2">{label}</div>
      {trend !== undefined && (
        <div
          className={clsx(
            'mt-2 text-xs font-medium inline-flex items-center gap-0.5',
            isPositive ? 'text-success' : 'text-danger'
          )}
        >
          {isPositive ? '▲' : '▼'} {trend}
          {trendLabel && <span className="text-text-muted ml-1">{trendLabel}</span>}
        </div>
      )}
    </div>
  )
}
