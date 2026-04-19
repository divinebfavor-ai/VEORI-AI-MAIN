import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function Input({
  label,
  error,
  hint,
  className = '',
  id,
  type = 'text',
  style: extra = {},
  ...props
}) {
  const [show, setShow]       = useState(false)
  const [focused, setFocused] = useState(false)
  const inputId    = id || label?.toLowerCase().replace(/\s+/g, '-')
  const isPassword = type === 'password'
  const inputType  = isPassword ? (show ? 'text' : 'password') : type

  const borderColor = error
    ? 'rgba(255,59,78,0.40)'
    : focused
    ? 'rgba(0,229,122,0.50)'
    : 'var(--border-rest)'

  const boxShadow = error
    ? focused ? '0 0 0 3px rgba(255,59,78,0.10)' : 'none'
    : focused
    ? '0 0 0 3px rgba(0,229,122,0.08)'
    : 'none'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label
          htmlFor={inputId}
          className="label-caps"
          style={{ cursor: 'default' }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <input
          id={inputId}
          type={inputType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={className}
          style={{
            width: '100%',
            height: 44,
            background: 'var(--s2)',
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            padding: isPassword ? '0 40px 0 12px' : '0 12px',
            fontSize: 14,
            color: 'var(--t1)',
            outline: 'none',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            boxShadow,
            fontFamily: 'inherit',
            ...extra,
          }}
          placeholder={props.placeholder}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: 'var(--t3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 0,
            }}
          >
            {show ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
          </button>
        )}
      </div>
      {(error || hint) && (
        <p style={{ fontSize: 11, color: error ? 'var(--red)' : 'var(--t3)' }}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
