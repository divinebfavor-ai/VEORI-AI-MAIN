import React from 'react'
import clsx from 'clsx'

/*
  Veori Glass Button
  Variants: primary | secondary | ghost | danger | gold
  Sizes: sm (32px) | md (40px) | lg (46px) | icon (36×36)
*/

const STYLES = {
  primary: {
    base:  { background: '#00C37A', color: '#000000', border: '1px solid transparent', fontWeight: 600, boxShadow: '0 0 16px rgba(0,195,122,0.20), 0 2px 8px rgba(0,195,122,0.12)' },
    hover: { background: '#00A868', boxShadow: '0 0 24px rgba(0,195,122,0.35), 0 4px 12px rgba(0,195,122,0.20)', transform: 'translateY(-1px)' },
    act:   { transform: 'translateY(0)', background: '#009960' },
  },
  secondary: {
    base:  { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.70)', border: '1px solid rgba(255,255,255,0.10)', fontWeight: 500, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
    hover: { background: 'rgba(255,255,255,0.09)', borderColor: 'rgba(255,255,255,0.18)', color: '#FFFFFF' },
    act:   { background: 'rgba(255,255,255,0.12)' },
  },
  ghost: {
    base:  { background: 'transparent', color: 'rgba(255,255,255,0.40)', border: '1px solid transparent', fontWeight: 400 },
    hover: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.80)' },
    act:   { background: 'rgba(255,255,255,0.08)' },
  },
  danger: {
    base:  { background: 'rgba(255,68,68,0.10)', color: '#FF4444', border: '1px solid rgba(255,68,68,0.22)', fontWeight: 500, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
    hover: { background: 'rgba(255,68,68,0.18)', borderColor: 'rgba(255,68,68,0.40)' },
    act:   { background: 'rgba(255,68,68,0.24)' },
  },
  gold: {
    base:  { background: 'rgba(201,168,76,0.10)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.22)', fontWeight: 500, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
    hover: { background: 'rgba(201,168,76,0.18)', borderColor: 'rgba(201,168,76,0.40)' },
    act:   { background: 'rgba(201,168,76,0.24)' },
  },
}

const SIZES = {
  sm:   { h: 32,  fs: 12, px: 12 },
  md:   { h: 40,  fs: 13, px: 16 },
  lg:   { h: 46,  fs: 14, px: 20 },
  icon: { h: 36,  fs: 14, px: 0,  w: 36 },
}

export default function Button({
  children, variant = 'secondary', size = 'md',
  loading = false, disabled = false,
  className = '', style: extra = {},
  onClick, type = 'button', ...props
}) {
  const [hov, setHov] = React.useState(false)
  const [act, setAct] = React.useState(false)

  const V = STYLES[variant] || STYLES.secondary
  const D = SIZES[size]     || SIZES.md

  const computed = {
    height: D.h, fontSize: D.fs, borderRadius: 8,
    paddingLeft:  D.w ? 0 : D.px,
    paddingRight: D.w ? 0 : D.px,
    ...(D.w ? { width: D.w } : {}),
    ...V.base,
    ...(hov && !disabled && !loading ? V.hover : {}),
    ...(act && !disabled && !loading ? V.act   : {}),
    transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
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
        'focus-visible:outline-none focus-ring',
        (disabled || loading) && 'opacity-40 cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin" style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" viewBox="0 0 24 24">
          <circle opacity={0.25} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
          <path  opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : children}
    </button>
  )
}
