import React from 'react'
import clsx from 'clsx'

export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={clsx(
        'bg-card border border-border-subtle rounded-xl p-6',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
