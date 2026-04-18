import React, { useState } from 'react'
import clsx from 'clsx'
import { Eye, EyeOff } from 'lucide-react'

export default function Input({
  label,
  error,
  className = '',
  id,
  type = 'text',
  ...props
}) {
  const [show, setShow] = useState(false)
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  const isPassword = type === 'password'
  const inputType = isPassword ? (show ? 'text' : 'password') : type

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="label-caps">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          className={clsx(
            'w-full h-[44px] bg-surface border rounded-[6px] px-3 text-[15px] text-text-primary placeholder-text-muted',
            'focus:outline-none focus:border-primary transition-colors duration-150',
            error ? 'border-danger' : 'border-border-subtle',
            isPassword && 'pr-10',
            className
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
            tabIndex={-1}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
