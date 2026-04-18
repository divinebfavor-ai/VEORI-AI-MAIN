import React from 'react'
import clsx from 'clsx'

const variants = {
  primary:   'bg-primary hover:bg-primary-hover text-black font-semibold',
  secondary: 'bg-transparent border border-border-default hover:border-border-default text-text-primary hover:bg-elevated',
  danger:    'bg-danger hover:bg-red-500 text-white font-semibold',
  ghost:     'bg-transparent text-text-secondary hover:text-text-primary hover:bg-elevated',
  gold:      'bg-gold hover:bg-yellow-500 text-black font-semibold',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs h-8',
  md: 'px-5 py-2.5 text-sm h-[44px]',
  lg: 'px-6 py-3 text-base h-12',
  icon: 'w-9 h-9 p-0',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[6px] transition-colors duration-150',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        variants[variant],
        sizes[size],
        (disabled || loading) && 'opacity-40 cursor-not-allowed',
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
