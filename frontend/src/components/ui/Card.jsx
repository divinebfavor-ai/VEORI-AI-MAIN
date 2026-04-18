import React from 'react'
import clsx from 'clsx'

export default function Card({ children, className = '', hover = false, active = false, onClick, ...props }) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-card border border-border-subtle rounded-lg',
        hover && 'transition-colors duration-150 hover:border-border-default cursor-pointer',
        active && 'border-primary',
        onClick && 'cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
