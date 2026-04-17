import React from 'react'
import clsx from 'clsx'

export default function Input({
  label,
  error,
  className = '',
  id,
  ...props
}) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          'w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
          'transition-colors duration-150',
          error
            ? 'border-danger focus:ring-danger/40 focus:border-danger'
            : 'border-border-default',
          className
        )}
        {...props}
      />
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
    </div>
  )
}
