import React, { useState, useEffect } from 'react'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import { analytics } from '../../services/api'

export default function SystemStatusBar() {
  const { calls: liveCalls } = useLiveCalls()
  const liveCount = liveCalls.length
  const [stats, setStats] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const load = () => {
      analytics.getDashboard().then(r => {
        const d = r.data?.data || r.data || {}
        setStats(d.stats || {})
        setLastUpdate(new Date())
      }).catch(() => {})
    }
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  // Tick every 5s to update relative time
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const callsToday = stats?.calls_today ?? '—'
  const hotLeads   = stats?.hot_leads   ?? '—'
  const deals      = stats?.deals_under_contract ?? '—'

  const since = lastUpdate
    ? (() => {
        const s = Math.floor((Date.now() - lastUpdate) / 1000)
        if (s < 60)   return `${s}s ago`
        if (s < 3600) return `${Math.floor(s / 60)}m ago`
        return `${Math.floor(s / 3600)}h ago`
      })()
    : null

  const isActive = liveCount > 0

  const sep = (
    <span style={{ color: 'rgba(255,255,255,0.14)', fontSize: 11, userSelect: 'none' }}>·</span>
  )

  return (
    <div style={{
      height: 34,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 'calc(240px + 16px)',
      paddingRight: 16,
      background: 'rgba(255,255,255,0.015)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      flexShrink: 0,
      fontSize: 11,
      fontWeight: 500,
      color: 'rgba(255,255,255,0.30)',
      letterSpacing: '0.04em',
      userSelect: 'none',
    }}>

      {/* System state */}
      {isActive ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#00C37A' }}>
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          CALLING ACTIVE
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.30)' }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'rgba(255,255,255,0.20)', flexShrink: 0,
            display: 'inline-block',
          }} />
          IDLE — READY
        </span>
      )}

      {sep}

      {isActive && (
        <>
          <span>
            <span style={{ color: 'rgba(255,255,255,0.80)' }}>{liveCount}</span>
            {' '}live {liveCount === 1 ? 'line' : 'lines'}
          </span>
          {sep}
        </>
      )}

      <span>
        <span style={{ color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums' }}>{callsToday}</span> calls today
      </span>

      {sep}

      <span style={{ color: hotLeads > 0 ? '#C9A84C' : 'rgba(255,255,255,0.30)', fontVariantNumeric: 'tabular-nums' }}>
        {hotLeads} hot leads
      </span>

      {sep}

      <span>
        <span style={{ color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums' }}>{deals}</span> under contract
      </span>

      {since && (
        <>
          {sep}
          <span style={{ color: 'rgba(255,255,255,0.22)', fontVariantNumeric: 'tabular-nums' }}>
            updated {since}
          </span>
        </>
      )}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* System health — right */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.28)' }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#00C37A', flexShrink: 0,
          display: 'inline-block',
          boxShadow: '0 0 6px rgba(0,195,122,0.60)',
        }} />
        All systems online
      </span>
    </div>
  )
}
