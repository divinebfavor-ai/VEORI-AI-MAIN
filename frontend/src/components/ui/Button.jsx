import React from 'react'
import clsx from 'clsx'

/*
  Variants:
    primary   — solid green, black text
    secondary — subtle surface bg + border
    ghost     — transparent, fills on hover
    danger    — red-tinted bg + border
    gold      — gold-tinted bg + border

  Sizes: sm (32px) · md (40px, default) · lg (46px) · icon (36×36)
*/

export default function Button({
  children,
  variant  = 'secondary',
  size     = 'md',
  loading  = false,
  disabled = false,
  className = '',
  style: extra = {},
  onClick,
  type = 'button',
  ...props
}) {
  const [hov, setHov] = React.useState(false)
  const [act, setAct] = React.useState(false)

  const styles = {
    primary: {
      base:  { background: 'var(--green)', color: '#000', border: '1px solid transparent', fontWeight: 600 },
      hover: { filter: 'brightness(1.08)' },
      act:   { filter: 'brightness(0.92)' },
    },
    secondary: {
      base:  { background: 'var(--s3)', color: 'var(--t2)', border: '1px solid var(--border-rest)', fontWeight: 500 },
      hover: { background: 'var(--s4)', borderColor: 'var(--border-active)', color: 'var(--t1)' },
      act:   { background: 'var(--s5)' },
    },
    ghost: {
      base:  { background: 'transparent', color: 'var(--t3)', border: '1px solid transparent', fontWeight: 500 },
      hover: { background: 'var(--s3)', color: 'var(--t1)' },
      act:   { background: 'var(--s4)' },
    },
    danger: {
      base:  { background: 'rgba(255,59,78,0.09)', color: 'var(--red)', border: '1px solid rgba(255,59,78,0.22)', fontWeight: 500 },
      hover: { background: 'rgba(255,59,78,0.15)', borderColor: 'rgba(255,59,78,0.40)' },
      act:   { background: 'rgba(255,59,78,0.20)' },
    },
    gold: {
      base:  { background: 'rgba(212,168,67,0.10)', color: 'var(--gold)', border: '1px solid rgba(212,168,67,0.22)', fontWeight: 500 },
      hover: { background: 'rgba(212,168,67,0.17)', borderColor: 'rgba(212,168,67,0.40)' },
      act:   { background: 'rgba(212,168,67,0.22)' },
    },
  }

  const V = styles[variant] || styles.secondary

  const dims = {
    sm:   { h: 32, fs: 12, px: 12 },
    md:   { h: 40, fs: 13, px: 16 },
    lg:   { h: 46, fs: 14, px: 20 },
    icon: { h: 36, fs: 14, px:  0, w: 36 },
  }
  const D = dims[size] || dims.md

  const computed = {
    height: D.h, fontSize: D.fs, borderRadius: 6,
    paddingLeft: D.w ? 0 : D.px, paddingRight: D.w ? 0 : D.px,
    ...(D.w ? { width: D.w } : {}),
    ...V.base,
    ...(hov && !disabled && !loading ? V.hover : {}),
    ...(act && !disabled && !loading ? V.act   : {}),
    ...extra,
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setAct(false) }}
      onMouseDown={() => setAct(true)}
      onMouseUp={() => setAct(false)}
      style={computed}
      className={clsx(
        'inline-flex items-center justify-center gap-2 leading-none select-none',
        'transition-all duration-150 focus-visible:outline-none focus-ring',
        (disabled || loading) && 'opacity-40 cursor-not-allowed',
        className
      )}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin" style={{ width: 13, height: 13, flexShrink: 0 }}
          fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : children}
    </button>
  )
}
